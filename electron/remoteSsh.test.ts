import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  MAX_RECONNECT_ATTEMPTS,
  RemoteSshManager,
  buildAttachArgs,
  buildTunnelArgs,
  attachCommand,
  buildInstallScript,
  buildMasterArgs,
  DEFAULT_INSTALL_SPEC,
  DISCOVERY_SCRIPT,
  discoveryCommand,
  INSTALL_REMOTE_COMMAND,
  installSpec,
  isRememberablePath,
  parseFoundMira,
  parseInstallOutput,
  shQuote,
  buildMuxAttachArgs,
  buildMuxForwardArgs,
  classifySshFailure,
  defaultRemoteSshDeps,
  getFreePort,
  parseAttachOutput,
  parseSshConfigHosts,
  parseMiraCommand,
  parseSshTarget,
  sshExecutable,
  waitForPort,
  type RemoteSshDeps,
  type SshChild,
} from './remoteSsh'
import type { SshPromptRequest } from './sshAskpass'

const TOKEN = 'tok_0123456789abcdefghijklmnop'

function attachJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ protocol: 1, ok: true, port: 40123, token: TOKEN, version: '0.5.0', pid: 4242, mira_home: '/home/ana/.mira', started: false, ...overrides })
}

describe('parseSshTarget', () => {
  it('accepts aliases, user@host and ports', () => {
    expect(parseSshTarget('lab')).toEqual({ destination: 'lab', port: null })
    expect(parseSshTarget(' ana@gpu01.lab.example ')).toEqual({ destination: 'ana@gpu01.lab.example', port: null })
    expect(parseSshTarget('ana@10.0.0.5:2222')).toEqual({ destination: 'ana@10.0.0.5', port: 2222 })
    expect(parseSshTarget('[fe80::1]:22')).toEqual({ destination: 'fe80::1', port: 22 })
  })

  it('rejects anything ssh could read as an option or command', () => {
    for (const value of ['', '-oProxyCommand=evil', 'ana@-oProxyCommand=x', '-lab', 'a b', 'host;rm -rf ~', 'host:0', 'host:70000', '$(id)@h']) {
      expect(parseSshTarget(value)).toBeNull()
    }
  })
})

describe('ssh command construction', () => {
  it('runs attach in batch mode behind an option terminator', () => {
    expect(buildAttachArgs({ destination: 'ana@lab', port: 2222 }, 'mira')).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', '2222', 'ana@lab', '--', "sh -lc 'mira remote attach --json'",
    ])
    expect(buildAttachArgs({ destination: 'ana@lab', port: 2222 }).at(-1)).toBe(discoveryCommand(null))
    expect(buildAttachArgs({ destination: 'lab', port: null }, '/opt/mira/bin/mira').at(-1))
      .toBe("sh -lc '/opt/mira/bin/mira remote attach --json'")
    expect(attachCommand('~/.local/bin/mira')).toBe("sh -lc '~/.local/bin/mira remote attach --json'")
  })

  it('accepts only plain paths as the remote mira command', () => {
    // Empty means "not set": discover.
    expect(parseMiraCommand(undefined)).toBe('')
    expect(parseMiraCommand('  ')).toBe('')
    expect(parseMiraCommand('mira')).toBe('mira')
    expect(parseMiraCommand('/opt/mira/bin/mira')).toBe('/opt/mira/bin/mira')
    expect(parseMiraCommand('~/venvs/mira-1.2/bin/mira')).toBe('~/venvs/mira-1.2/bin/mira')
    for (const value of ["mira'; rm -rf ~; '", 'mira remote', '$(id)', '-x', 'a`b`', 'C:\\mira.exe']) {
      expect(parseMiraCommand(value)).toBeNull()
    }
  })

  it('forwards a loopback port to the engine loopback port', () => {
    expect(buildTunnelArgs({ destination: 'lab', port: null }, 51000, 40123)).toEqual([
      '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
      '-L', '127.0.0.1:51000:127.0.0.1:40123', 'lab',
    ])
  })

  it('uses the built-in OpenSSH client on Windows', () => {
    expect(sshExecutable('darwin')).toBe('ssh')
    expect(sshExecutable('win32', { SystemRoot: 'C:\\Windows' }, () => true)).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
    expect(sshExecutable('win32', { SystemRoot: 'C:\\Windows' }, () => false)).toBe('ssh.exe')
  })
})

describe('parseAttachOutput', () => {
  it('reads the attach line even after login-shell banners', () => {
    expect(parseAttachOutput({ code: 0, stdout: `Welcome to lab\n${attachJson({ started: true })}\n`, stderr: '' })).toEqual({
      ok: true, port: 40123, token: TOKEN, version: '0.5.0', pid: 4242, miraHome: '/home/ana/.mira', started: true,
    })
  })

  it('maps engine failure codes and unknown codes', () => {
    const failure = (code: string) => JSON.stringify({ protocol: 1, ok: false, error: { code, message: 'boom' } })
    for (const code of ['start_failed', 'health_timeout', 'lease_conflict', 'config_invalid', 'internal']) {
      expect(parseAttachOutput({ code: 1, stdout: failure(code), stderr: '' })).toEqual({ ok: false, code, message: 'boom' })
    }
    expect(parseAttachOutput({ code: 1, stdout: failure('weird'), stderr: '' })).toMatchObject({ ok: false, code: 'internal' })
  })

  it('rejects other protocols and incomplete responses', () => {
    expect(parseAttachOutput({ code: 0, stdout: attachJson({ protocol: 2 }), stderr: '' })).toMatchObject({ code: 'incompatible' })
    expect(parseAttachOutput({ code: 0, stdout: attachJson({ port: 'x' }), stderr: '' })).toMatchObject({ code: 'invalid_output' })
    expect(parseAttachOutput({ code: 0, stdout: attachJson({ token: 'short' }), stderr: '' })).toMatchObject({ code: 'invalid_output' })
    expect(parseAttachOutput({ code: 0, stdout: 'garbage\n{not json}\n{"other":1}', stderr: '' })).toMatchObject({ code: 'invalid_output' })
  })

  it('only trusts the last non-empty stdout line', () => {
    // A JSON-looking banner line followed by something else is not a result.
    expect(parseAttachOutput({ code: 0, stdout: `${attachJson()}\nbye from .profile\n`, stderr: '' }))
      .toEqual({ ok: false, code: 'invalid_output', message: 'Unexpected output from server: bye from .profile' })
    expect(parseAttachOutput({ code: 0, stdout: `\n${attachJson()}\n\n  \n`, stderr: '' })).toMatchObject({ ok: true, port: 40123 })
    expect(parseAttachOutput({ code: 1, stdout: '', stderr: '' })).toEqual({ ok: false, code: 'invalid_output', message: 'Unexpected output from server.' })
  })

  it('classifies ssh and shell failures', () => {
    expect(parseAttachOutput({ code: 255, stdout: '', stderr: 'ana@lab: Permission denied (publickey).' })).toMatchObject({ code: 'auth_required' })
    expect(parseAttachOutput({ code: 255, stdout: '', stderr: 'Host key verification failed.' })).toMatchObject({ code: 'host_key' })
    expect(parseAttachOutput({ code: 255, stdout: '', stderr: 'ssh: Could not resolve hostname lab' })).toMatchObject({ code: 'ssh_failed', message: 'ssh: Could not resolve hostname lab' })
    expect(parseAttachOutput({ code: 127, stdout: '', stderr: 'sh: 1: mira: not found' })).toMatchObject({ code: 'not_installed' })
    expect(parseAttachOutput({ code: 127, stdout: '', stderr: 'sh: 1: /opt/mira/bin/mira: No such file or directory' })).toMatchObject({ code: 'not_installed' })
    expect(parseAttachOutput({ code: 2, stdout: '', stderr: "Error: No such command 'remote'." })).toMatchObject({ code: 'too_old' })
    expect(parseAttachOutput({ code: null, stdout: '', stderr: '' })).toMatchObject({ code: 'ssh_failed' })
  })
})

describe('parseSshConfigHosts', () => {
  it('lists connectable aliases and skips patterns', () => {
    const config = [
      'Host *',
      '  ServerAliveInterval 30',
      'Host lab gpu01 # comment',
      '  HostName gpu01.lab.example',
      'Host=bastion',
      'host *.internal !blocked web?',
      'Host lab',
      'Match host foo',
      '  User x',
    ].join('\n')
    expect(parseSshConfigHosts(config)).toEqual(['lab', 'gpu01', 'bastion'])
  })
})

class FakeChild extends EventEmitter implements SshChild {
  stdin = new PassThrough()
  input = ''
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  constructor(readonly args: string[]) {
    super()
    this.stdin.on('data', (chunk) => { this.input += String(chunk) })
  }
  kill(): boolean {
    if (!this.killed) {
      this.killed = true
      this.emit('exit', null)
      this.emit('close', null)
    }
    return true
  }
  finish(code: number, stdout = '', stderr = ''): void {
    this.stdout.end(stdout)
    this.stderr.end(stderr)
    setImmediate(() => {
      this.emit('exit', code)
      this.emit('close', code)
    })
  }
}

function harness(script: {
  attach: Array<{ code: number; stdout?: string; stderr?: string }>
  portOpen?: boolean
  onInstall?: (child: FakeChild) => void
  lastPaths?: Record<string, string>
}) {
  const children: FakeChild[] = []
  const lastPaths = { ...(script.lastPaths ?? {}) }
  const timers: Array<{ callback: () => void; ms: number }> = []
  const attachQueue = [...script.attach]
  const log = vi.fn()
  const deps: RemoteSshDeps = {
    executable: 'ssh',
    platform: 'darwin',
    spawn: (_command, args) => {
      const child = new FakeChild(args)
      children.push(child)
      if (args.at(-1) === INSTALL_REMOTE_COMMAND) {
        script.onInstall?.(child)
      } else if (!args.includes('-N')) {
        const next = attachQueue.shift() ?? { code: 255, stderr: 'no script' }
        child.finish(next.code, next.stdout ?? '', next.stderr ?? '')
      }
      return child
    },
    getFreePort: vi.fn(async (preferred?: number | null) => preferred ?? 51000),
    waitForPort: vi.fn(async () => script.portOpen ?? true),
    waitForFile: vi.fn(async () => true),
    log,
    setTimer: (callback, ms) => {
      if (ms >= 1000) timers.push({ callback, ms })
      return { ms }
    },
    clearTimer: () => {},
    // Below the 1s filter above, so only reconnect timers are captured.
    attachTimeoutMs: 500,
    tunnelReadyTimeoutMs: 500,
    loginTimeoutMs: 500,
    installTimeoutMs: 900,
    installSpec: () => DEFAULT_INSTALL_SPEC,
    lastMiraPaths: {
      get: vi.fn(async (host: string) => lastPaths[host] ?? null),
      set: vi.fn(async (host: string, value: string) => { lastPaths[host] = value }),
    },
  }
  return { manager: new RemoteSshManager(deps), children, timers, deps, log, lastPaths }
}

const tunnels = (children: FakeChild[]) => children.filter((child) => child.args.includes('-N'))

describe('RemoteSshManager', () => {
  it('attaches, forwards a port and keeps the token in memory only', async () => {
    const { manager, children, log } = harness({ attach: [{ code: 0, stdout: attachJson() }] })
    const statuses: unknown[] = []
    manager.onStatus((status) => statuses.push(status))

    const status = await manager.connect('ana@lab')

    expect(status).toEqual({ phase: 'connected', host: 'ana@lab', localPort: 51000, version: '0.5.0', error: null, attempt: 0, miraPath: null })
    expect(manager.getToken()).toBe(TOKEN)
    expect(tunnels(children)[0].args).toContain('127.0.0.1:51000:127.0.0.1:40123')
    expect(JSON.stringify(statuses)).not.toContain(TOKEN)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(log.mock.calls)).not.toContain('ana@lab')
  })

  it('reports non-retryable attach failures without starting a tunnel', async () => {
    const { manager, children } = harness({ attach: [{ code: 255, stderr: 'Permission denied (publickey).' }] })
    const status = await manager.connect('lab')
    expect(status.phase).toBe('error')
    expect(status.error?.code).toBe('auth_required')
    expect(tunnels(children)).toHaveLength(0)
    expect(manager.getToken()).toBeNull()
  })

  it('rejects hosts that could inject ssh options', async () => {
    const { manager, children } = harness({ attach: [] })
    const status = await manager.connect('-oProxyCommand=touch /tmp/x')
    expect(status.error?.code).toBe('invalid_host')
    expect(children).toHaveLength(0)
  })

  it('runs the configured remote command and reconnects when it changes', async () => {
    const { manager, children } = harness({ attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson() }] })
    await manager.connect('lab', { miraCommand: '/opt/mira/bin/mira' })
    const attaches = () => children.filter((child) => !child.args.includes('-N'))
    expect(attaches()[0].args.at(-1)).toBe("sh -lc '/opt/mira/bin/mira remote attach --json'")

    await manager.connect('lab', { miraCommand: '/opt/mira/bin/mira' })
    expect(attaches()).toHaveLength(1)

    await manager.connect('lab')
    expect(attaches()).toHaveLength(2)
    expect(attaches()[1].args.at(-1)).toBe(discoveryCommand(null))

    const invalid = await manager.connect('lab', { miraCommand: "mira'; id; '" })
    expect(invalid.error?.code).toBe('invalid_command')
    expect(attaches()).toHaveLength(2)
  })

  it('fails when the forwarded port never opens', async () => {
    const { manager, children } = harness({ attach: [{ code: 0, stdout: attachJson() }], portOpen: false })
    const status = await manager.connect('lab')
    expect(status.error?.code).toBe('tunnel_failed')
    expect(tunnels(children)[0].killed).toBe(true)
  })

  it('reconnects with backoff after the tunnel drops and reuses the local port', async () => {
    const { manager, children, timers, deps } = harness({
      attach: [{ code: 0, stdout: attachJson() }, { code: 255, stderr: 'ssh: connect to host lab: Network is unreachable' }, { code: 0, stdout: attachJson({ port: 40999 }) }],
    })
    await manager.connect('lab')
    tunnels(children)[0].emit('exit', 255)

    expect(manager.status()).toMatchObject({ phase: 'reconnecting', attempt: 1 })
    expect(manager.getToken()).toBeNull()
    expect(timers.at(-1)?.ms).toBe(1000)

    timers.at(-1)!.callback()
    await vi.waitFor(() => expect(manager.status()).toMatchObject({ phase: 'reconnecting', attempt: 2 }))
    expect(timers.at(-1)?.ms).toBe(2000)

    timers.at(-1)!.callback()
    await vi.waitFor(() => expect(manager.status().phase).toBe('connected'))
    expect(deps.getFreePort).toHaveBeenLastCalledWith(51000)
    expect(tunnels(children).at(-1)!.args).toContain('127.0.0.1:51000:127.0.0.1:40999')
    expect(manager.getToken()).toBe(TOKEN)
  })

  it('takes port and token from the fresh attach after a server-side restart', async () => {
    const ROTATED = 'tok_rotated_0123456789abcdef'
    const { manager, children, timers } = harness({
      attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson({ port: 41555, token: ROTATED, started: true }) }],
    })
    await manager.connect('lab')
    tunnels(children)[0].emit('exit', 255)
    expect(manager.getToken()).toBeNull()
    timers.at(-1)!.callback()
    await vi.waitFor(() => expect(manager.status().phase).toBe('connected'))
    expect(manager.getToken()).toBe(ROTATED)
    expect(tunnels(children).at(-1)!.args).toContain('127.0.0.1:51000:127.0.0.1:41555')
    expect(children.filter((child) => !child.args.includes('-N'))).toHaveLength(2)
  })

  it('gives up after the maximum number of reconnect attempts', async () => {
    const failures = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, () => ({ code: 255, stderr: 'ssh: connect to host lab: Connection timed out' }))
    const { manager, children, timers } = harness({ attach: [{ code: 0, stdout: attachJson() }, ...failures] })
    await manager.connect('lab')
    tunnels(children)[0].emit('exit', 255)
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      const pending = timers.length
      timers.at(-1)!.callback()
      if (attempt < MAX_RECONNECT_ATTEMPTS) await vi.waitFor(() => expect(timers.length).toBe(pending + 1))
    }
    await vi.waitFor(() => expect(manager.status().phase).toBe('error'))
    expect(manager.status().error?.code).toBe('ssh_failed')
  })

  it('stops retrying when a reconnect hits a non-retryable error', async () => {
    const { manager, children, timers } = harness({ attach: [{ code: 0, stdout: attachJson() }, { code: 127, stderr: 'sh: mira: command not found' }] })
    await manager.connect('lab')
    tunnels(children)[0].emit('exit', 255)
    timers.at(-1)!.callback()
    await vi.waitFor(() => expect(manager.status().phase).toBe('error'))
    expect(manager.status().error?.code).toBe('not_installed')
  })

  it('rebuilds the tunnel after resume and ignores the old tunnel exiting', async () => {
    const { manager, children } = harness({ attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson() }] })
    await manager.connect('lab')
    const first = tunnels(children)[0]
    manager.handleResume()
    expect(first.killed).toBe(true)
    await vi.waitFor(() => expect(manager.status().phase).toBe('connected'))
    expect(tunnels(children)).toHaveLength(2)
  })

  it('is idempotent for the active host and disconnects cleanly', async () => {
    const { manager, children } = harness({ attach: [{ code: 0, stdout: attachJson() }] })
    const [a, b] = await Promise.all([manager.connect('lab'), manager.connect('lab')])
    expect(a.phase).toBe('connected')
    expect(b.phase).toBe('connected')
    expect(children.filter((child) => !child.args.includes('-N'))).toHaveLength(1)

    const status = manager.disconnect()
    expect(status).toMatchObject({ phase: 'idle', host: null })
    expect(tunnels(children)[0].killed).toBe(true)
    expect(manager.getToken()).toBeNull()
  })

  it('switching hosts tears down the previous connection', async () => {
    const { manager, children } = harness({ attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson({ port: 40200 }) }] })
    await manager.connect('lab')
    await manager.connect('other')
    expect(tunnels(children)[0].killed).toBe(true)
    expect(manager.status()).toMatchObject({ phase: 'connected', host: 'other' })
  })
})

describe('local port helpers', () => {
  it('finds a free loopback port, falls back when the preferred one is taken, and detects listeners', async () => {
    const busy = net.createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
    const busyPort = (busy.address() as net.AddressInfo).port
    try {
      const port = await getFreePort(busyPort)
      expect(port).not.toBe(busyPort)
      expect(await waitForPort(busyPort, 1000)).toBe(true)
      expect(await waitForPort(port, 300, 50)).toBe(false)
    } finally {
      await new Promise((resolve) => busy.close(resolve))
    }
  })
})

// Drives real child processes through a stand-in `ssh`: attach prints banner
// noise plus the JSON line; the tunnel listens on the forwarded local port.
const FAKE_SSH = `
const net = require('node:net')
const args = process.argv.slice(2)
if (!args.includes('-N')) {
  process.stdout.write('Last login: Mon\\n')
  process.stdout.write(JSON.stringify({ protocol: 1, ok: true, port: 40123, token: '${TOKEN}', version: '0.5.0', pid: 1, mira_home: '/h/.mira', started: true }) + '\\n')
  process.exit(0)
}
const forward = args[args.indexOf('-L') + 1].split(':')
net.createServer((socket) => socket.end()).listen(Number(forward[1]), forward[0])
`

describe('RemoteSshManager with real processes', () => {
  it('attaches, forwards and tears the tunnel down', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mira-fake-ssh-'))
    const script = path.join(dir, 'ssh.cjs')
    await writeFile(script, FAKE_SSH)
    const manager = new RemoteSshManager({
      ...defaultRemoteSshDeps(() => {}),
      spawn: (_command, args) => spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }),
      tunnelReadyTimeoutMs: 5000,
    })
    try {
      const status = await manager.connect('ana@lab')
      expect(status).toMatchObject({ phase: 'connected', version: '0.5.0' })
      expect(manager.getToken()).toBe(TOKEN)
      expect(await waitForPort(status.localPort!, 1000)).toBe(true)

      manager.disconnect()
      await vi.waitFor(async () => expect(await waitForPort(status.localPort!, 200, 50)).toBe(false))
    } finally {
      manager.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('interactive ssh command construction', () => {
  it('drops BatchMode when prompts can be shown', () => {
    expect(buildAttachArgs({ destination: 'lab', port: null }, 'mira', true)).toEqual(['-o', 'ConnectTimeout=15', 'lab', '--', "sh -lc 'mira remote attach --json'"])
    expect(buildTunnelArgs({ destination: 'lab', port: null }, 51000, 40123, true)).not.toContain('BatchMode=yes')
  })

  it('logs in once with a master and runs attach and the forward over it without prompting', () => {
    const target = { destination: 'ana@lab', port: 2222 }
    expect(buildMasterArgs(target, '/tmp/mira-ssh-x/m1')).toEqual([
      '-N', '-o', 'ControlMaster=yes', '-o', 'ControlPath=/tmp/mira-ssh-x/m1', '-o', 'ControlPersist=no',
      '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15', '-p', '2222', 'ana@lab',
    ])
    expect(buildMuxAttachArgs(target, '/tmp/mira-ssh-x/m1', 'mira')).toEqual([
      '-o', 'ControlMaster=no', '-o', 'ControlPath=/tmp/mira-ssh-x/m1', '-o', 'BatchMode=yes', '-p', '2222',
      'ana@lab', '--', "sh -lc 'mira remote attach --json'",
    ])
    expect(buildMuxForwardArgs(target, '/tmp/mira-ssh-x/m1', 'forward', 51000, 40123)).toEqual([
      '-o', 'ControlMaster=no', '-o', 'ControlPath=/tmp/mira-ssh-x/m1', '-o', 'BatchMode=yes', '-p', '2222',
      '-O', 'forward', '-L', '127.0.0.1:51000:127.0.0.1:40123', 'ana@lab',
    ])
  })

  it('treats a changed host key as a hard error', () => {
    const stderr = '@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.'
    expect(classifySshFailure(255, stderr)).toMatchObject({ code: 'host_key_changed' })
    expect(classifySshFailure(255, 'Host key verification failed.')).toMatchObject({ code: 'host_key' })
    expect(classifySshFailure(null, '')).toMatchObject({ code: 'ssh_failed' })
  })
})

const PASSWORD = 'correct horse battery staple'

// Fake ssh for the multiplexed flow: the master stays up until killed and
// "logs in" when the test opens its control socket; mux clients answer from
// the script.
function muxHarness(options: {
  platform?: NodeJS.Platform
  version?: { major: number; minor: number; windows: boolean; raw: string } | null
  attach?: Array<{ code: number; stdout?: string; stderr?: string }>
  forwardCode?: number
  answers?: Array<string | null>
  onInstall?: (child: FakeChild) => void
} = {}) {
  const children: FakeChild[] = []
  const timers: Array<{ callback: () => void; ms: number }> = []
  const attachQueue = [...(options.attach ?? [{ code: 0, stdout: attachJson() }])]
  const answers = [...(options.answers ?? [PASSWORD])]
  const handlers: Array<(text: string) => Promise<string | null>> = []
  const envs: Array<Record<string, string> | undefined> = []
  const disposed = vi.fn()
  let login: ((ok: boolean) => void) | null = null
  const log = vi.fn()
  const prompt = vi.fn(async (_request: SshPromptRequest, _signal: AbortSignal) => answers.shift() ?? null)
  const deps: RemoteSshDeps = {
    executable: 'ssh',
    platform: options.platform ?? 'darwin',
    spawn: (_command, args, env) => {
      const child = new FakeChild(args)
      children.push(child)
      envs.push(env)
      if (args.includes('ControlMaster=yes')) return child
      if (args.at(-1) === INSTALL_REMOTE_COMMAND) {
        options.onInstall?.(child)
      } else if (args.includes('-O')) {
        child.finish(options.forwardCode ?? 0, '', options.forwardCode ? 'mux_client_forward: forwarding request failed' : '')
      } else if (!args.includes('-N')) {
        const next = attachQueue.shift() ?? { code: 255, stderr: 'no script' }
        child.finish(next.code, next.stdout ?? '', next.stderr ?? '')
      }
      return child
    },
    getFreePort: vi.fn(async (preferred?: number | null) => preferred ?? 51000),
    waitForPort: vi.fn(async () => true),
    waitForFile: vi.fn(() => new Promise<boolean>((resolve) => { login = resolve })),
    log,
    setTimer: (callback, ms) => {
      if (ms >= 1000 && ms <= 30_000) timers.push({ callback, ms })
      return { ms }
    },
    clearTimer: () => {},
    attachTimeoutMs: 500,
    tunnelReadyTimeoutMs: 500,
    loginTimeoutMs: 500,
    openAskpass: vi.fn(async (handler) => {
      handlers.push(handler)
      return { env: { SSH_ASKPASS: '/askpass.sh', MIRA_ASKPASS_NONCE: `n${handlers.length}` }, dispose: disposed }
    }),
    prompt,
    controlDir: async () => '/tmp/mira-ssh-x',
    sshVersion: async () => (options.version === undefined ? { major: 10, minor: 3, windows: false, raw: 'OpenSSH_10.3' } : options.version),
  }
  const masters = () => children.filter((child) => child.args.includes('ControlMaster=yes'))
  const muxAttaches = () => children.filter((child) => child.args.includes('ControlMaster=no') && child.args.includes('--'))
  // ssh asks a question through askpass, then (if answered) finishes logging in.
  const askAndLogin = async (text = "ana@lab's password: ") => {
    await vi.waitFor(() => expect(handlers.length).toBeGreaterThan(0))
    const answer = await handlers.at(-1)!(text)
    if (answer !== null) login?.(true)
    return answer
  }
  return { manager: new RemoteSshManager(deps), deps, children, timers, prompt, log, envs, disposed, masters, muxAttaches, askAndLogin, handlers }
}

describe('RemoteSshManager with interactive prompts (ControlMaster)', () => {
  it('asks for the password once and runs attach and the forward over the master', async () => {
    const h = muxHarness()
    const connecting = h.manager.connect('ana@lab')
    expect(await h.askAndLogin()).toBe(PASSWORD)
    const status = await connecting

    expect(status).toMatchObject({ phase: 'connected', localPort: 51000, version: '0.5.0' })
    expect(h.manager.getToken()).toBe(TOKEN)
    expect(h.prompt).toHaveBeenCalledTimes(1)
    expect(h.prompt.mock.calls[0][0]).toEqual({ host: 'ana@lab', kind: 'secret', text: "ana@lab's password: ", retry: false })
    expect(h.masters()).toHaveLength(1)
    expect(h.masters()[0].args).toContain('ControlPath=/tmp/mira-ssh-x/m1')
    expect(h.envs[0]).toMatchObject({ SSH_ASKPASS: '/askpass.sh' })
    // Mux clients reuse the login and never prompt.
    const clients = h.children.filter((child) => !child.args.includes('ControlMaster=yes'))
    expect(clients.map((child) => child.args.includes('-O') ? 'forward' : 'attach')).toEqual(['attach', 'forward'])
    for (const client of clients) {
      expect(client.args).toContain('ControlPath=/tmp/mira-ssh-x/m1')
      expect(client.args).toContain('BatchMode=yes')
    }
    expect(h.disposed).toHaveBeenCalled()
    const logged = JSON.stringify(h.log.mock.calls)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('password:')
  })

  it('marks a repeated prompt as a retry and classifies host-key questions', async () => {
    const h = muxHarness({ answers: ['yes', 'wrong', PASSWORD] })
    const connecting = h.manager.connect('lab')
    await vi.waitFor(() => expect(h.handlers).toHaveLength(1))
    const hostKey = "The authenticity of host 'lab (10.0.0.5)' can't be established.\nED25519 key fingerprint is SHA256:abc.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? "
    expect(await h.handlers[0](hostKey)).toBe('yes')
    expect(await h.handlers[0]("ana@lab's password: ")).toBe('wrong')
    await h.askAndLogin()
    await connecting
    expect(h.prompt.mock.calls.map(([request]) => [request.kind, request.retry])).toEqual([['host_key', false], ['secret', false], ['secret', true]])
  })

  it('stops ssh when a prompt is cancelled', async () => {
    const h = muxHarness({ answers: [null] })
    const connecting = h.manager.connect('lab')
    expect(await h.askAndLogin()).toBeNull()
    const status = await connecting
    expect(status.error?.code).toBe('auth_cancelled')
    expect(h.masters()[0].killed).toBe(true)
    expect(h.muxAttaches()).toHaveLength(0)
  })

  it('reports a failed login from the master without attaching', async () => {
    const h = muxHarness()
    const connecting = h.manager.connect('lab')
    await vi.waitFor(() => expect(h.masters()).toHaveLength(1))
    h.masters()[0].finish(255, '', 'ana@lab: Permission denied (publickey,password).')
    expect((await connecting).error?.code).toBe('auth_required')
    const changed = muxHarness()
    const again = changed.manager.connect('lab')
    await vi.waitFor(() => expect(changed.masters()).toHaveLength(1))
    changed.masters()[0].finish(255, '', 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.')
    expect((await again).error?.code).toBe('host_key_changed')
  })

  it('reuses a live master after sleep without a new login', async () => {
    const h = muxHarness({ attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson() }] })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    await connecting
    h.manager.handleResume()
    await vi.waitFor(() => expect(h.muxAttaches()).toHaveLength(2))
    await vi.waitFor(() => expect(h.manager.status().phase).toBe('connected'))
    expect(h.masters()).toHaveLength(1)
    expect(h.masters()[0].killed).toBe(false)
    expect(h.prompt).toHaveBeenCalledTimes(1)
    // Same engine port: the existing forward is kept.
    expect(h.children.filter((child) => child.args.includes('-O'))).toHaveLength(1)
  })

  it('moves the forward when the engine port changed while asleep', async () => {
    const h = muxHarness({ attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson({ port: 40999 }) }] })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    await connecting
    h.manager.handleResume()
    await vi.waitFor(() => expect(h.manager.status().phase).toBe('connected'))
    const forwards = h.children.filter((child) => child.args.includes('-O')).map((child) => child.args.slice(child.args.indexOf('-O') + 1, child.args.indexOf('-O') + 4))
    expect(forwards).toEqual([
      ['forward', '-L', '127.0.0.1:51000:127.0.0.1:40123'],
      ['cancel', '-L', '127.0.0.1:51000:127.0.0.1:40123'],
      ['forward', '-L', '127.0.0.1:51000:127.0.0.1:40999'],
    ])
  })

  it('logs in again when the master is gone', async () => {
    const h = muxHarness({ answers: [PASSWORD, PASSWORD], attach: [{ code: 0, stdout: attachJson() }, { code: 0, stdout: attachJson() }] })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    await connecting
    h.masters()[0].emit('exit', 255)
    expect(h.manager.status()).toMatchObject({ phase: 'reconnecting', attempt: 1 })
    expect(h.manager.getToken()).toBeNull()
    h.timers.at(-1)!.callback()
    await vi.waitFor(() => expect(h.masters()).toHaveLength(2))
    await h.askAndLogin()
    await vi.waitFor(() => expect(h.manager.status().phase).toBe('connected'))
    expect(h.masters()[1].args).toContain('ControlPath=/tmp/mira-ssh-x/m2')
    expect(h.prompt).toHaveBeenCalledTimes(2)
  })

  it('drops a master that no longer answers after sleep and logs in again', async () => {
    const h = muxHarness({
      answers: [PASSWORD, PASSWORD],
      attach: [{ code: 0, stdout: attachJson() }, { code: 255, stderr: 'mux_client_request_session: read from master failed: Broken pipe' }, { code: 0, stdout: attachJson() }],
    })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    await connecting
    h.manager.handleResume()
    await vi.waitFor(() => expect(h.masters()[0].killed).toBe(true))
    expect(h.manager.status().phase).toBe('reconnecting')
    h.timers.at(-1)!.callback()
    await h.askAndLogin()
    await vi.waitFor(() => expect(h.manager.status().phase).toBe('connected'))
    expect(h.masters()).toHaveLength(2)
  })

  it('cancels a pending prompt on disconnect', async () => {
    const h = muxHarness()
    let seen: AbortSignal | null = null
    h.prompt.mockImplementationOnce((_request, signal) => {
      seen = signal
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null)))
    })
    const connecting = h.manager.connect('lab')
    await vi.waitFor(() => expect(h.handlers).toHaveLength(1))
    const answer = h.handlers[0]("ana@lab's password: ")
    await vi.waitFor(() => expect(seen).not.toBeNull())
    h.manager.disconnect()
    expect(seen!.aborted).toBe(true)
    expect(await answer).toBeNull()
    expect(h.masters()[0].killed).toBe(true)
    expect((await connecting).phase).toBe('idle')
  })

  it('fails cleanly when the forward is refused', async () => {
    const h = muxHarness({ forwardCode: 255 })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    expect((await connecting).error?.code).toBe('tunnel_failed')
  })
})

describe('RemoteSshManager on Windows', () => {
  it('asks through askpass for attach and the tunnel separately (no ControlMaster)', async () => {
    const h = muxHarness({ platform: 'win32', version: { major: 9, minor: 5, windows: true, raw: 'OpenSSH_for_Windows_9.5' } })
    const status = await h.manager.connect('lab')
    expect(status.phase).toBe('connected')
    expect(h.masters()).toHaveLength(0)
    const [attach, tunnel] = h.children
    expect(attach.args).not.toContain('BatchMode=yes')
    expect(tunnel.args).toContain('-N')
    expect(tunnel.args).not.toContain('BatchMode=yes')
    expect(h.envs[0]).toMatchObject({ SSH_ASKPASS: '/askpass.sh' })
    expect(h.envs[1]).toMatchObject({ SSH_ASKPASS: '/askpass.sh' })
  })

  it('explains that old Windows OpenSSH cannot show password prompts', async () => {
    const h = muxHarness({
      platform: 'win32',
      version: { major: 8, minor: 1, windows: true, raw: 'OpenSSH_for_Windows_8.1' },
      attach: [{ code: 255, stderr: 'ana@lab: Permission denied (password).' }],
    })
    const status = await h.manager.connect('lab')
    expect(status.error).toEqual({ code: 'prompt_unsupported', message: 'OpenSSH_for_Windows_8.1' })
    expect(h.children[0].args).toContain('BatchMode=yes')
    expect(h.deps.openAskpass).not.toHaveBeenCalled()
  })
})

describe('remote mira discovery wrapper', () => {
  it('is one line that quotes safely through any login shell', () => {
    expect(DISCOVERY_SCRIPT).not.toMatch(/[\r\n]/)
    // fish treats \\ and \' inside single quotes as escapes; zsh RC_QUOTES reads ''.
    expect(DISCOVERY_SCRIPT).not.toMatch(/\\\\|\\'|''/)
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
    expect(shQuote('')).toBe("''")
    expect(discoveryCommand(null)).toBe(`sh -lc ${shQuote(DISCOVERY_SCRIPT)} mira ''`)
    expect(discoveryCommand("/home/ana/my envs/it's/bin/mira").endsWith(` mira '/home/ana/my envs/it'\\''s/bin/mira'`)).toBe(true)
    // A path that cannot be remembered is not passed at all.
    expect(discoveryCommand('relative/mira')).toBe(discoveryCommand(null))
    expect(discoveryCommand('/a/b\\c')).toBe(discoveryCommand(null))
  })

  it('uses a manual command on its own, without discovery', () => {
    expect(attachCommand('/opt/mira/bin/mira', '/last/bin/mira')).toBe("sh -lc '/opt/mira/bin/mira remote attach --json'")
    expect(attachCommand('', '/last/bin/mira')).toBe(discoveryCommand('/last/bin/mira'))
  })

  it('only remembers plain absolute paths', () => {
    expect(isRememberablePath('/home/ana/.mira/bin/mira')).toBe(true)
    expect(isRememberablePath("/srv/My Envs/it's $HOME/bin/mira")).toBe(true)
    for (const value of ['', '/', 'mira', '~/bin/mira', '/a\nb', '/a\\b', `/${'x'.repeat(1100)}`, 7, null]) {
      expect(isRememberablePath(value)).toBe(false)
    }
  })

  it('reads the marker line and keeps it out of the attach result', () => {
    const stdout = `Welcome\nmira-remote-path: last /srv/my env/bin/mira\n${attachJson()}\n`
    expect(parseFoundMira(stdout)).toEqual({ source: 'last', path: '/srv/my env/bin/mira' })
    expect(parseFoundMira('mira-remote-path: bogus /x\nhello')).toBeNull()
    expect(parseAttachOutput({ code: 0, stdout, stderr: '' })).toMatchObject({ ok: true, port: 40123 })
    // The marker alone is not "output" to complain about.
    expect(parseAttachOutput({ code: 1, stdout: 'mira-remote-path: path /usr/bin/mira\n', stderr: '' }))
      .toEqual({ ok: false, code: 'invalid_output', message: 'Unexpected output from server.' })
  })

  it('classifies not installed, too old and ssh failures', () => {
    const notInstalled = '{"protocol":1,"ok":false,"error":{"code":"not_installed","message":"mira was not found on the server."}}'
    expect(parseAttachOutput({ code: 127, stdout: notInstalled, stderr: '' })).toEqual({ ok: false, code: 'not_installed', message: 'mira was not found on the server.' })
    // A stale launcher whose interpreter is gone.
    expect(parseAttachOutput({ code: 127, stdout: 'mira-remote-path: launcher /h/.mira/bin/mira', stderr: '/h/.mira/bin/mira: 2: exec: /old/env/bin/python: not found' })).toMatchObject({ code: 'not_installed' })
    expect(parseAttachOutput({ code: 2, stdout: '', stderr: "Usage: mira [OPTIONS] COMMAND\nError: No such command 'remote'." })).toEqual({ ok: false, code: 'too_old', message: "Error: No such command 'remote'." })
    expect(parseAttachOutput({ code: 2, stdout: '', stderr: 'Error: No such option: --json' })).toMatchObject({ code: 'too_old' })
    // Real Typer output from mira-engine 0.3.5rc1 (PyPI).
    const boxed = "Usage: mira [OPTIONS] COMMAND [ARGS]...\nTry 'mira --help' for help.\n╭─ Error ─────────╮\n│ No such command 'remote'.        │\n╰─────────────────╯\n"
    expect(parseAttachOutput({ code: 2, stdout: '', stderr: boxed })).toEqual({ ok: false, code: 'too_old', message: "No such command 'remote'." })
    expect(parseInstallOutput({ code: 2, stdout: 'Installed mira-engine 0.3.5rc1\n', stderr: boxed.replace('remote', 'setup') }))
      .toEqual({ ok: false, code: 'too_old', message: "No such command 'setup'.", version: '0.3.5rc1' })
    expect(parseAttachOutput({ code: 0, stdout: attachJson({ protocol: 0 }), stderr: '' })).toMatchObject({ code: 'too_old' })
    expect(parseAttachOutput({ code: 0, stdout: attachJson({ protocol: 2 }), stderr: '' })).toMatchObject({ code: 'incompatible' })
    expect(parseAttachOutput({ code: 255, stdout: '', stderr: 'ssh: connect to host lab port 22: Connection refused' })).toMatchObject({ code: 'ssh_failed' })
  })
})

// Runs the wrapper the way sshd does (`$SHELL -c <command>`) under every
// shell available here, with a throwaway HOME and stub `mira` executables.
describe.skipIf(process.platform === 'win32')('remote mira discovery wrapper (real shells)', () => {
  const shells = ['/bin/sh', '/bin/bash', '/bin/zsh', '/bin/dash', '/bin/tcsh', '/usr/bin/fish', '/opt/homebrew/bin/fish'].filter((shell) => existsSync(shell))

  async function sandbox() {
    const root = await mkdtemp(path.join(tmpdir(), 'mira discovery '))
    const home = path.join(root, 'home')
    const bin = path.join(root, 'path bin')
    await mkdir(home, { recursive: true })
    await mkdir(bin, { recursive: true })
    const stub = async (file: string, label: string) => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `#!/bin/sh\necho "${label} $*"\n`)
      await chmod(file, 0o755)
    }
    const run = (shell: string, lastPath: string | null, env: Record<string, string> = {}) => {
      const result = spawnSync(shell, ['-c', discoveryCommand(lastPath)], {
        env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...env },
        encoding: 'utf8',
      })
      return { code: result.status, stdout: result.stdout, stderr: result.stderr }
    }
    return { root, home, bin, stub, run, cleanup: () => rm(root, { recursive: true, force: true }) }
  }

  it.each(shells)('finds the launcher, then the last path, then PATH (%s)', async (shell) => {
    const box = await sandbox()
    try {
      const last = path.join(box.root, "it's my env", 'bin', 'mira')
      await box.stub(last, 'last')
      await box.stub(path.join(box.bin, 'mira'), 'path')

      // PATH only.
      let out = box.run(shell, null)
      expect(out.code).toBe(0)
      expect(parseFoundMira(out.stdout)).toEqual({ source: 'path', path: path.join(box.bin, 'mira') })
      expect(out.stdout).toContain('path remote attach --json')

      // The remembered path (spaces and a quote in it) beats PATH.
      out = box.run(shell, last)
      expect(parseFoundMira(out.stdout)).toEqual({ source: 'last', path: last })
      expect(out.stdout.trim().split('\n').at(-1)).toBe('last remote attach --json')

      // The launcher beats both; MIRA_HOME moves it.
      const launcher = path.join(box.home, '.mira', 'bin', 'mira')
      await box.stub(launcher, 'launcher')
      out = box.run(shell, last)
      expect(parseFoundMira(out.stdout)).toEqual({ source: 'launcher', path: launcher })
      const custom = path.join(box.root, 'custom home')
      await box.stub(path.join(custom, 'bin', 'mira'), 'custom')
      out = box.run(shell, last, { MIRA_HOME: custom })
      expect(parseFoundMira(out.stdout)).toEqual({ source: 'launcher', path: path.join(custom, 'bin', 'mira') })

      // A launcher that is not executable is skipped.
      await chmod(launcher, 0o644)
      out = box.run(shell, last)
      expect(parseFoundMira(out.stdout)?.source).toBe('last')
    } finally {
      await box.cleanup()
    }
  })

  it.each(shells)('reports not_installed as JSON when nothing is found (%s)', async (shell) => {
    const box = await sandbox()
    try {
      const out = box.run(shell, path.join(box.root, 'gone', 'mira'))
      expect(out.code).toBe(127)
      expect(parseFoundMira(out.stdout)).toBeNull()
      expect(parseAttachOutput(out)).toEqual({ ok: false, code: 'not_installed', message: 'mira was not found on the server.' })
    } finally {
      await box.cleanup()
    }
  })
})

describe('RemoteSshManager discovery', () => {
  const found = (source: string, file: string, json = attachJson()) => `mira-remote-path: ${source} ${file}\n${json}\n`

  it('passes the remembered path and remembers the one that worked', async () => {
    const h = harness({
      attach: [{ code: 0, stdout: found('path', '/opt/conda/envs/mira/bin/mira') }],
      lastPaths: { lab: '/old/bin/mira' },
    })
    const status = await h.manager.connect('lab')
    expect(status).toMatchObject({ phase: 'connected', miraPath: '/opt/conda/envs/mira/bin/mira' })
    expect(h.deps.lastMiraPaths!.get).toHaveBeenCalledWith('lab')
    expect(h.children[0].args.at(-1)).toBe(discoveryCommand('/old/bin/mira'))
    await vi.waitFor(() => expect(h.lastPaths.lab).toBe('/opt/conda/envs/mira/bin/mira'))
    // Paths are not logged.
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('/opt/conda')
    expect(h.log).toHaveBeenCalledWith('remote_ssh.mira_found', { source: 'path', ok: true })
  })

  it('does not remember a path that failed or is already remembered', async () => {
    const tooOld = harness({ attach: [{ code: 2, stdout: 'mira-remote-path: path /usr/bin/mira\n', stderr: "Error: No such command 'remote'." }] })
    const status = await tooOld.manager.connect('lab')
    expect(status.error?.code).toBe('too_old')
    expect(status.miraPath).toBe('/usr/bin/mira')
    expect(tooOld.deps.lastMiraPaths!.set).not.toHaveBeenCalled()

    const same = harness({ attach: [{ code: 0, stdout: found('last', '/srv/bin/mira') }], lastPaths: { lab: '/srv/bin/mira' } })
    await same.manager.connect('lab')
    expect(same.deps.lastMiraPaths!.set).not.toHaveBeenCalled()
  })

  it('short-circuits discovery when a path is set by hand', async () => {
    const h = harness({ attach: [{ code: 0, stdout: attachJson() }], lastPaths: { lab: '/old/bin/mira' } })
    const status = await h.manager.connect('lab', { miraCommand: '/opt/mira/bin/mira' })
    expect(h.children[0].args.at(-1)).toBe("sh -lc '/opt/mira/bin/mira remote attach --json'")
    expect(h.deps.lastMiraPaths!.get).not.toHaveBeenCalled()
    expect(h.deps.lastMiraPaths!.set).not.toHaveBeenCalled()
    expect(status.miraPath).toBe('/opt/mira/bin/mira')
  })

  it('reports the wrapper not_installed result', async () => {
    const h = harness({ attach: [{ code: 127, stdout: '{"protocol":1,"ok":false,"error":{"code":"not_installed","message":"mira was not found on the server."}}' }] })
    const status = await h.manager.connect('lab')
    expect(status).toMatchObject({ phase: 'error', error: { code: 'not_installed' }, miraPath: null })
  })
})

describe('install script', () => {
  it('targets an isolated venv, prefers uv, and needs no sudo', () => {
    const script = buildInstallScript(DEFAULT_INSTALL_SPEC)
    expect(script).toContain('MIRA_HOME="${MIRA_HOME:-$HOME/.mira}"')
    expect(script).toContain('venv="$MIRA_HOME/venv"')
    expect(script).toContain("spec='mira-engine>=0.4.0rc1'")
    expect(script).toContain('set -e')
    expect(script).toContain(`uv venv --python '>=3.11' "$venv"`)
    expect(script).toContain('uv pip install --python "$venv/bin/python" -U "$spec"')
    expect(script).toContain('for candidate in python3.13 python3.12 python3.11 python3; do')
    expect(script).toContain('"$py" -m venv "$venv"')
    expect(script).toContain('"$venv/bin/python" -m pip install -U pip')
    expect(script).toContain('"$venv/bin/python" -m pip install -U "$spec"')
    expect(script).toContain('"$venv/bin/mira" remote setup --json')
    expect(script).toContain('main </dev/null')
    expect(script).not.toMatch(/^\s*sudo\b|conda (install|activate)/m)
    // The uv installer is shown as advice, never run.
    expect(script).toMatch(/echo '  - install uv:  curl -LsSf https:\/\/astral\.sh\/uv\/install\.sh \| sh' >&2/)
    expect(INSTALL_REMOTE_COMMAND).toBe("sh -lc 'exec sh -s'")
  })

  it('quotes the package spec and accepts an override from the environment', () => {
    expect(installSpec({})).toBe(DEFAULT_INSTALL_SPEC)
    expect(installSpec({ MIRA_REMOTE_INSTALL_SPEC: ' git+https://github.com/MIRA-Intelligence/mira@feat/server-edition ' }))
      .toBe('git+https://github.com/MIRA-Intelligence/mira@feat/server-edition')
    for (const bad of ['', '   ', '--index-url=http://evil', 'a\nb']) {
      expect(installSpec({ MIRA_REMOTE_INSTALL_SPEC: bad })).toBe(DEFAULT_INSTALL_SPEC)
    }
    expect(buildInstallScript("pkg @ file:///srv/it's here")).toContain(`spec='pkg @ file:///srv/it'\\''s here'`)
  })

  it('parses setup results, missing setup, missing python and ssh failures', () => {
    const setup = '{"protocol":1,"ok":true,"launcher":"/h/.mira/bin/mira","executable":"/h/.mira/venv/bin/python","version":"0.5.0"}'
    expect(parseInstallOutput({ code: 0, stdout: `Installed mira-engine 0.5.0\n${setup}\n`, stderr: 'noise' }))
      .toEqual({ ok: true, version: '0.5.0', launcher: '/h/.mira/bin/mira', executable: '/h/.mira/venv/bin/python' })
    expect(parseInstallOutput({ code: 2, stdout: 'Installed mira-engine 0.3.5rc1\n', stderr: "Error: No such command 'setup'." }))
      .toEqual({ ok: false, code: 'too_old', message: "Error: No such command 'setup'.", version: '0.3.5rc1' })
    expect(parseInstallOutput({ code: 3, stdout: '{"protocol":1,"ok":false,"error":{"code":"no_python","message":"none"}}', stderr: '' }))
      .toMatchObject({ ok: false, code: 'no_python' })
    expect(parseInstallOutput({ code: 1, stdout: '{"protocol":1,"ok":false,"error":{"code":"internal","message":"disk full"}}', stderr: '' }))
      .toMatchObject({ ok: false, code: 'install_failed', message: 'disk full' })
    expect(parseInstallOutput({ code: 1, stdout: '', stderr: 'ERROR: No matching distribution found for mira-engine>=0.4.0rc1' }))
      .toMatchObject({ ok: false, code: 'install_failed', message: 'ERROR: No matching distribution found for mira-engine>=0.4.0rc1' })
    expect(parseInstallOutput({ code: 255, stdout: '', stderr: 'Permission denied (publickey).' })).toMatchObject({ code: 'auth_required' })
    expect(parseInstallOutput({ code: 255, stdout: '', stderr: 'Connection reset' })).toMatchObject({ code: 'ssh_failed' })
  })
})

// Runs the real install script with `sh -s` (as on the server) against stub
// uv / python / mira executables that record what they were asked to do.
describe.skipIf(process.platform === 'win32')('install script (real sh, stub tools)', () => {
  const VENV_PYTHON = `#!/bin/sh
echo "venv-python $*" >> "$LOG"
case "$*" in *importlib*) echo "\${STUB_VERSION:-0.5.0}" ;; esac
exit 0
`
  const VENV_MIRA = `#!/bin/sh
echo "venv-mira $*" >> "$LOG"
if [ -n "$STUB_NO_SETUP" ]; then echo "Error: No such command 'setup'." >&2; exit 2; fi
printf '{"protocol":1,"ok":true,"launcher":"%s","executable":"%s","version":"0.5.0"}\\n' "$MIRA_HOME/bin/mira" "$MIRA_HOME/venv/bin/python"
`
  const MAKE_VENV = 'mkdir -p "$d/bin"; touch "$d/pyvenv.cfg"; cp "$STUBS/venv-python" "$d/bin/python"; cp "$STUBS/venv-mira" "$d/bin/mira"'
  const UV = `#!/bin/sh
echo "uv $*" >> "$LOG"
if [ "$1" = venv ]; then d="$4"; ${MAKE_VENV}; fi
`
  const GOOD_PYTHON = `#!/bin/sh
echo "$(basename "$0") $*" >> "$LOG"
case "$1" in -c) exit 0 ;; -m) d="$3"; ${MAKE_VENV} ;; esac
`
  const OLD_PYTHON = '#!/bin/sh\nexit 1\n'

  async function sandbox(tools: Record<string, string>) {
    const root = await mkdtemp(path.join(tmpdir(), 'mira install '))
    const stubs = path.join(root, 'stubs')
    const bin = path.join(root, 'bin')
    await mkdir(stubs, { recursive: true })
    await mkdir(bin, { recursive: true })
    const write = async (file: string, body: string) => { await writeFile(file, body); await chmod(file, 0o755) }
    await write(path.join(stubs, 'venv-python'), VENV_PYTHON)
    await write(path.join(stubs, 'venv-mira'), VENV_MIRA)
    // Shadow every python the script looks for, so the host's own never count.
    for (const name of ['python3.13', 'python3.12', 'python3.11', 'python3']) await write(path.join(bin, name), OLD_PYTHON)
    for (const [name, body] of Object.entries(tools)) await write(path.join(bin, name), body)
    const log = path.join(root, 'log')
    const miraHome = path.join(root, "mira home's")
    const run = (spec = DEFAULT_INSTALL_SPEC, env: Record<string, string> = {}) => {
      const result = spawnSync('/bin/sh', ['-s'], {
        input: buildInstallScript(spec),
        env: { HOME: root, MIRA_HOME: miraHome, PATH: `${bin}:/usr/bin:/bin`, LOG: log, STUBS: stubs, ...env },
        encoding: 'utf8',
      })
      return { code: result.status, stdout: result.stdout, stderr: result.stderr }
    }
    const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
    return { root, miraHome, run, calls, cleanup: () => rm(root, { recursive: true, force: true }) }
  }

  it('creates the venv with uv, installs the spec and runs remote setup', async () => {
    const box = await sandbox({ uv: UV })
    try {
      const out = box.run('git+https://example.invalid/mira@branch')
      expect(out.code).toBe(0)
      const venv = path.join(box.miraHome, 'venv')
      expect(await box.calls()).toEqual([
        `uv venv --python >=3.11 ${venv}`,
        `uv pip install --python ${venv}/bin/python -U git+https://example.invalid/mira@branch`,
        `venv-python -c import importlib.metadata as m; print(m.version("mira-engine"))`,
        'venv-mira remote setup --json',
      ])
      expect(parseInstallOutput(out)).toEqual({ ok: true, version: '0.5.0', launcher: path.join(box.miraHome, 'bin', 'mira'), executable: path.join(venv, 'bin', 'python') })

      // Run again: the existing venv is upgraded in place.
      const again = box.run()
      expect(again.code).toBe(0)
      expect(again.stdout).toContain(`Upgrading the existing ${venv}`)
      expect((await box.calls()).filter((line) => line.startsWith('uv venv'))).toHaveLength(1)
    } finally {
      await box.cleanup()
    }
  })

  it('falls back to the first Python 3.11+ with venv and pip', async () => {
    const box = await sandbox({ 'python3.12': GOOD_PYTHON })
    try {
      const out = box.run()
      expect(out.code).toBe(0)
      const venv = path.join(box.miraHome, 'venv')
      const calls = await box.calls()
      expect(calls).toContain(`python3.12 -m venv ${venv}`)
      expect(calls).toContain('venv-python -m pip install -U pip')
      expect(calls).toContain('venv-python -m pip install -U mira-engine>=0.4.0rc1')
      expect(calls.at(-1)).toBe('venv-mira remote setup --json')
      expect(parseInstallOutput(out)).toMatchObject({ ok: true })
    } finally {
      await box.cleanup()
    }
  })

  it('fails with guidance when neither uv nor Python 3.11+ exists', async () => {
    const box = await sandbox({})
    try {
      const out = box.run()
      expect(out.code).toBe(3)
      expect(out.stderr).toContain('curl -LsSf https://astral.sh/uv/install.sh | sh')
      expect(out.stderr).toContain('mira remote setup')
      expect(parseInstallOutput(out)).toMatchObject({ ok: false, code: 'no_python' })
      expect(await box.calls()).toEqual([])
    } finally {
      await box.cleanup()
    }
  })

  it('reports an engine without `remote setup` as too old', async () => {
    const box = await sandbox({ uv: UV })
    try {
      const out = box.run(DEFAULT_INSTALL_SPEC, { STUB_NO_SETUP: '1', STUB_VERSION: '0.3.5rc1' })
      expect(out.code).toBe(2)
      expect(parseInstallOutput(out)).toEqual({ ok: false, code: 'too_old', message: "Error: No such command 'setup'.", version: '0.3.5rc1' })
    } finally {
      await box.cleanup()
    }
  })

  it('stops at the first failing step', async () => {
    const box = await sandbox({ uv: `${UV}[ "$1" = pip ] && { echo 'error: No solution found' >&2; exit 1; }\nexit 0\n` })
    try {
      const out = box.run()
      expect(out.code).toBe(1)
      expect(parseInstallOutput(out)).toMatchObject({ ok: false, code: 'install_failed', message: 'error: No solution found' })
      expect((await box.calls()).some((line) => line.startsWith('venv-mira'))).toBe(false)
    } finally {
      await box.cleanup()
    }
  })
})

describe('RemoteSshManager install', () => {
  const NOT_INSTALLED = { code: 127, stdout: '{"protocol":1,"ok":false,"error":{"code":"not_installed","message":"mira was not found on the server."}}' }
  const SETUP_OK = 'Installed mira-engine 0.5.0\n{"protocol":1,"ok":true,"launcher":"/h/.mira/bin/mira","executable":"/h/.mira/venv/bin/python","version":"0.5.0"}\n'

  it('installs over the logged-in master, streams output and reconnects without a new prompt', async () => {
    let install: FakeChild | null = null
    const h = muxHarness({
      attach: [NOT_INSTALLED, { code: 0, stdout: `mira-remote-path: launcher /h/.mira/bin/mira\n${attachJson()}` }],
      onInstall: (child) => { install = child },
    })
    const connecting = h.manager.connect('lab')
    await h.askAndLogin()
    expect((await connecting).error?.code).toBe('not_installed')

    const chunks: string[] = []
    h.manager.onInstallOutput((chunk) => chunks.push(chunk))
    const installing = h.manager.install()
    await vi.waitFor(() => expect(install).not.toBeNull())
    const child = install as unknown as FakeChild
    // Over the master: BatchMode client, the script on stdin.
    expect(child.args).toContain('ControlPath=/tmp/mira-ssh-x/m1')
    expect(child.args).toContain('BatchMode=yes')
    await vi.waitFor(() => expect(child.input).toBe(h.manager.installPlan().script))
    child.stderr.write('Resolved 42 packages\n')
    child.finish(0, SETUP_OK)
    expect(await installing).toEqual({ ok: true, version: '0.5.0', launcher: '/h/.mira/bin/mira', executable: '/h/.mira/venv/bin/python' })
    expect(chunks.join('')).toContain('Resolved 42 packages')
    expect(chunks.join('')).toContain('Installed mira-engine 0.5.0')

    await vi.waitFor(() => expect(h.manager.status()).toMatchObject({ phase: 'connected', miraPath: '/h/.mira/bin/mira' }))
    expect(h.prompt).toHaveBeenCalledTimes(1)
    expect(h.masters()).toHaveLength(1)
    expect(h.log).toHaveBeenCalledWith('remote_ssh.install', { phase: 'done', code: null })
  })

  it('can be cancelled, and refuses to run twice or before a failed attach', async () => {
    const h = harness({ attach: [NOT_INSTALLED], onInstall: () => {} })
    expect(await h.manager.install()).toMatchObject({ ok: false, code: 'not_ready' })
    await h.manager.connect('lab')
    const installing = h.manager.install()
    await vi.waitFor(() => expect(h.children.some((child) => child.args.at(-1) === INSTALL_REMOTE_COMMAND)).toBe(true))
    expect(await h.manager.install()).toMatchObject({ ok: false, code: 'busy' })
    expect(h.manager.cancelInstall()).toBe(true)
    expect(await installing).toMatchObject({ ok: false, code: 'cancelled' })
    expect(h.children.find((child) => child.args.at(-1) === INSTALL_REMOTE_COMMAND)!.killed).toBe(true)
    expect(h.manager.status().phase).toBe('error')
    expect(h.manager.cancelInstall()).toBe(false)
  })

  it('times out, reports failures and stays in the error state', async () => {
    const timeout = harness({ attach: [NOT_INSTALLED], onInstall: () => {} })
    const timers: Array<{ callback: () => void; ms: number }> = []
    timeout.deps.setTimer = (callback, ms) => { timers.push({ callback, ms }); return { ms } }
    await timeout.manager.connect('lab')
    const installing = timeout.manager.install()
    await vi.waitFor(() => expect(timers.some((timer) => timer.ms === 900)).toBe(true))
    timers.find((timer) => timer.ms === 900)!.callback()
    expect(await installing).toMatchObject({ ok: false, code: 'timeout' })

    const failing = harness({ attach: [NOT_INSTALLED], onInstall: (child) => child.finish(1, '', 'ERROR: Could not find a version that satisfies the requirement mira-engine>=0.4.0rc1') })
    await failing.manager.connect('lab')
    expect(await failing.manager.install()).toMatchObject({ ok: false, code: 'install_failed' })
    expect(failing.manager.status()).toMatchObject({ phase: 'error', error: { code: 'not_installed' } })
  })

  it('logs in through askpass on Windows (no master)', async () => {
    let install: FakeChild | null = null
    const h = muxHarness({
      platform: 'win32',
      version: { major: 9, minor: 5, windows: true, raw: 'OpenSSH_for_Windows_9.5' },
      attach: [NOT_INSTALLED, { code: 0, stdout: attachJson() }],
      onInstall: (child) => { install = child; child.finish(0, SETUP_OK) },
    })
    expect((await h.manager.connect('lab')).error?.code).toBe('not_installed')
    expect(await h.manager.install()).toMatchObject({ ok: true })
    const child = install as unknown as FakeChild
    expect(child.args).not.toContain('BatchMode=yes')
    expect(h.envs[h.children.indexOf(child)]).toMatchObject({ SSH_ASKPASS: '/askpass.sh' })
    await vi.waitFor(() => expect(h.manager.status().phase).toBe('connected'))
  })
})
