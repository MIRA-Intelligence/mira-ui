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
    log,
    setTimer: (callback, ms) => {
      if (ms >= 1000) timers.push({ callback, ms })
      return { ms }
    },
    clearTimer: () => {},
    // Below the 1s filter above, so only reconnect timers are captured.
    attachTimeoutMs: 500,
    tunnelReadyTimeoutMs: 500,
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
