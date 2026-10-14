import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AskpassService,
  askpassSupported,
  classifyPrompt,
  parseSshVersion,
  writeAskpassHelpers,
} from './sshAskpass'
import { RemoteSshManager, defaultRemoteSshDeps, waitForPort } from './remoteSsh'

describe('prompt helpers', () => {
  it('classifies host-key confirmations and secrets', () => {
    expect(classifyPrompt("The authenticity of host 'lab' can't be established.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ")).toBe('host_key')
    expect(classifyPrompt("ana@lab's password: ")).toBe('secret')
    expect(classifyPrompt("Enter passphrase for key '/Users/ana/.ssh/id_ed25519': ")).toBe('secret')
    expect(classifyPrompt('Verification code: ')).toBe('secret')
  })

  it('parses OpenSSH versions and knows where askpass works', () => {
    expect(parseSshVersion('OpenSSH_10.3p1, LibreSSL 3.3.6')).toMatchObject({ major: 10, minor: 3, windows: false })
    expect(parseSshVersion('OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2')).toMatchObject({ major: 8, minor: 1, windows: true, raw: 'OpenSSH_for_Windows_8.1' })
    expect(parseSshVersion('ssh: command not found')).toBeNull()
    expect(askpassSupported('darwin', null)).toBe(true)
    expect(askpassSupported('linux', parseSshVersion('OpenSSH_7.4p1'))).toBe(true)
    expect(askpassSupported('win32', parseSshVersion('OpenSSH_for_Windows_8.1p1'))).toBe(false)
    expect(askpassSupported('win32', parseSshVersion('OpenSSH_for_Windows_9.5p1'))).toBe(true)
    expect(askpassSupported('win32', null)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('AskpassService', () => {
  let dir: string
  let service: AskpassService

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mira-askpass-test-'))
    service = new AskpassService({ helperDir: () => path.join(dir, 'helpers'), nodePath: process.execPath })
  })
  afterEach(async () => {
    await service.close()
    await rm(dir, { recursive: true, force: true })
  })

  const ask = (env: Record<string, string>, prompt: string) => new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(env.SSH_ASKPASS, [prompt], { env: { ...process.env, ...env } })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.on('close', (code) => resolve({ code, stdout }))
  })

  it('writes private, executable helpers outside the app archive', async () => {
    const helpers = await writeAskpassHelpers(path.join(dir, 'h'), 'darwin')
    expect(statSync(path.join(dir, 'h')).mode & 0o777).toBe(0o700)
    expect(statSync(helpers.script).mode & 0o777).toBe(0o700)
    expect(statSync(helpers.main).mode & 0o777).toBe(0o600)
  })

  it('answers the prompt of the attempt that owns the nonce', async () => {
    const handler = vi.fn(async (prompt: string) => (prompt === "ana@lab's password: " ? 'hunter2 with spaces' : null))
    const session = await service.open(handler)
    expect(session.env).toMatchObject({ SSH_ASKPASS_REQUIRE: 'force', DISPLAY: expect.any(String), MIRA_ASKPASS_NODE: process.execPath })
    expect(Object.keys(session.env)).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(statSync(path.dirname(session.env.MIRA_ASKPASS_HANDLE)).mode & 0o777).toBe(0o700)

    expect(await ask(session.env, "ana@lab's password: ")).toEqual({ code: 0, stdout: 'hunter2 with spaces\n' })
    expect(handler).toHaveBeenCalledWith("ana@lab's password: ")
  })

  it('exits non-zero on cancel, unknown nonces and after the attempt ends', async () => {
    const session = await service.open(async () => null)
    expect((await ask(session.env, 'Password: ')).code).toBe(1)

    const other = await service.open(async () => 'secret')
    expect((await ask({ ...other.env, MIRA_ASKPASS_NONCE: 'forged' }, 'Password: ')).code).toBe(1)
    other.dispose()
    expect((await ask(other.env, 'Password: ')).code).toBe(1)
  })

  it('removes its private socket directory on close', async () => {
    const control = await service.controlDir()
    expect(existsSync(control)).toBe(true)
    expect(control.length).toBeLessThan(40)
    await service.close()
    expect(existsSync(control)).toBe(false)
  })
})

// Real processes: a stand-in `ssh` that, as master, asks for the password
// through the real askpass helper, then serves a control socket that mux
// clients (attach, -O forward) use.
const MUX_FAKE_SSH = (password: string, token: string) => `
const net = require('node:net')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const opt = (name) => { const hit = args.find((arg) => arg.startsWith(name + '=')); return hit ? hit.slice(name.length + 1) : null }
const controlPath = opt('ControlPath')
if (opt('ControlMaster') === 'yes') {
  const asked = spawnSync(process.env.SSH_ASKPASS, ["ana@lab's password: "], { encoding: 'utf8' })
  if (asked.status !== 0 || asked.stdout !== ${JSON.stringify(password + '\n')}) {
    process.stderr.write('ana@lab: Permission denied (password).\\n')
    process.exit(255)
  }
  net.createServer((socket) => {
    socket.on('data', (data) => {
      const [command, host, port] = String(data).trim().split(' ')
      if (command !== 'forward') return socket.end('ok\\n')
      net.createServer((client) => client.end()).listen(Number(port), host, () => socket.end('ok\\n'))
    })
  }).listen(controlPath)
  process.on('SIGTERM', () => process.exit(0))
} else {
  const send = (message, done) => {
    const socket = net.connect(controlPath)
    socket.on('error', () => { process.stderr.write('Control socket connect: No such file or directory\\n'); process.exit(255) })
    socket.on('connect', () => socket.write(message))
    socket.on('data', () => { socket.end(); done() })
  }
  if (args.includes('-O')) {
    const spec = args[args.indexOf('-L') + 1].split(':')
    send('forward ' + spec[0] + ' ' + spec[1] + '\\n', () => process.exit(0))
  } else {
    send('check\\n', () => {
      process.stdout.write('Last login: Mon\\n' + JSON.stringify({ protocol: 1, ok: true, port: 40123, token: ${JSON.stringify(token)}, version: '0.5.0', pid: 1, mira_home: '/h/.mira', started: true }) + '\\n')
      process.exit(0)
    })
  }
}
`

describe.skipIf(process.platform === 'win32')('Remote-SSH password login end to end', () => {
  it('asks once through the real askpass helper and connects over the master', async () => {
    const TOKEN = 'tok_0123456789abcdefghijklmnop'
    const PASSWORD = 's3cret pass'
    const dir = await mkdtemp(path.join(tmpdir(), 'mira-mux-'))
    const script = path.join(dir, 'ssh.cjs')
    await writeFile(script, MUX_FAKE_SSH(PASSWORD, TOKEN))
    const service = new AskpassService({ helperDir: () => path.join(dir, 'helpers'), nodePath: process.execPath })
    const prompt = vi.fn(async () => PASSWORD)
    const log = vi.fn()
    const manager = new RemoteSshManager({
      ...defaultRemoteSshDeps(log),
      platform: process.platform,
      spawn: (_command, args, env) => spawn(process.execPath, [script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      }),
      sshVersion: async () => parseSshVersion('OpenSSH_10.3p1'),
      openAskpass: (handler) => service.open(handler),
      controlDir: () => service.controlDir(),
      prompt,
      tunnelReadyTimeoutMs: 5000,
    })
    try {
      const status = await manager.connect('ana@lab')
      expect(status).toMatchObject({ phase: 'connected', version: '0.5.0' })
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(manager.getToken()).toBe(TOKEN)
      expect(await waitForPort(status.localPort!, 1000)).toBe(true)
      expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD)

      manager.disconnect()
      await vi.waitFor(async () => expect(await waitForPort(status.localPort!, 200, 50)).toBe(false))
    } finally {
      manager.dispose()
      await service.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a wrong password as a failed login', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mira-mux-'))
    const script = path.join(dir, 'ssh.cjs')
    await writeFile(script, MUX_FAKE_SSH('right', 'tok_0123456789abcdefghijklmnop'))
    const service = new AskpassService({ helperDir: () => path.join(dir, 'helpers'), nodePath: process.execPath })
    const manager = new RemoteSshManager({
      ...defaultRemoteSshDeps(() => {}),
      spawn: (_command, args, env) => spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }),
      sshVersion: async () => parseSshVersion('OpenSSH_10.3p1'),
      openAskpass: (handler) => service.open(handler),
      controlDir: () => service.controlDir(),
      prompt: async () => 'wrong',
    })
    try {
      expect((await manager.connect('ana@lab')).error?.code).toBe('auth_required')
    } finally {
      manager.dispose()
      await service.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

it('ships a POSIX helper that sh can parse', async () => {
  if (process.platform === 'win32') return
  const dir = await mkdtemp(path.join(tmpdir(), 'mira-askpass-sh-'))
  try {
    const helpers = await writeAskpassHelpers(dir, 'linux')
    expect(spawnSync('sh', ['-n', helpers.script]).status).toBe(0)
    expect(spawnSync(process.execPath, ['--check', helpers.main]).status).toBe(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
