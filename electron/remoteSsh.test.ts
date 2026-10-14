import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  buildMasterArgs,
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
    expect(buildAttachArgs({ destination: 'ana@lab', port: 2222 })).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', '2222', 'ana@lab', '--', "sh -lc 'mira remote attach --json'",
    ])
    expect(buildAttachArgs({ destination: 'lab', port: null }, '/opt/mira/bin/mira').at(-1))
      .toBe("sh -lc '/opt/mira/bin/mira remote attach --json'")
    expect(attachCommand('~/.local/bin/mira')).toBe("sh -lc '~/.local/bin/mira remote attach --json'")
  })

  it('accepts only plain paths as the remote mira command', () => {
    expect(parseMiraCommand(undefined)).toBe('mira')
    expect(parseMiraCommand('  ')).toBe('mira')
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
    expect(parseAttachOutput({ code: 2, stdout: '', stderr: "Error: No such command 'remote'." })).toMatchObject({ code: 'incompatible' })
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
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  constructor(readonly args: string[]) { super() }
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

function harness(script: { attach: Array<{ code: number; stdout?: string; stderr?: string }>; portOpen?: boolean }) {
  const children: FakeChild[] = []
  const timers: Array<{ callback: () => void; ms: number }> = []
  const attachQueue = [...script.attach]
  const log = vi.fn()
  const deps: RemoteSshDeps = {
    executable: 'ssh',
    platform: 'darwin',
    spawn: (_command, args) => {
      const child = new FakeChild(args)
      children.push(child)
      if (!args.includes('-N')) {
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
  }
  return { manager: new RemoteSshManager(deps), children, timers, deps, log }
}

const tunnels = (children: FakeChild[]) => children.filter((child) => child.args.includes('-N'))

describe('RemoteSshManager', () => {
  it('attaches, forwards a port and keeps the token in memory only', async () => {
    const { manager, children, log } = harness({ attach: [{ code: 0, stdout: attachJson() }] })
    const statuses: unknown[] = []
    manager.onStatus((status) => statuses.push(status))

    const status = await manager.connect('ana@lab')

    expect(status).toEqual({ phase: 'connected', host: 'ana@lab', localPort: 51000, version: '0.5.0', error: null, attempt: 0 })
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
    expect(attaches()[1].args.at(-1)).toBe("sh -lc 'mira remote attach --json'")

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
    expect(buildMuxAttachArgs(target, '/tmp/mira-ssh-x/m1')).toEqual([
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
      if (args.includes('-O')) {
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
