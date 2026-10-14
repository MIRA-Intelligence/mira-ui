import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { TOKEN_PATTERN } from './engineToken'

// Remote-SSH (Mode B in MIRA-Intelligence/mira docs/server-edition/architecture.md):
// the system `ssh` starts or attaches the user's engine on the server
// (`mira remote attach --json`, MIRA-Intelligence/mira#166), then forwards a
// local loopback port to it. SSH handles authentication; Mira stores no SSH
// credentials, and the gateway token stays in this process's memory.

export const REMOTE_PROTOCOL = 1
export const DEFAULT_MIRA_COMMAND = 'mira'
// Guidance for exit 127 lives in MIRA-Intelligence/mira docs/remote-ssh.md.
export const REMOTE_SSH_DOC = 'docs/remote-ssh.md'

// The remote command runs inside `sh -lc '...'`, so only plain path
// characters are allowed (a leading ~ still expands in the inner shell).
export function parseMiraCommand(value: string | null | undefined): string | null {
  const command = (value ?? '').trim() || DEFAULT_MIRA_COMMAND
  if (command.length > 255 || command.startsWith('-')) return null
  return /^[A-Za-z0-9_./~+-]+$/.test(command) ? command : null
}

export function attachCommand(miraCommand = DEFAULT_MIRA_COMMAND): string {
  return `sh -lc '${miraCommand} remote attach --json'`
}

export type RemoteSshErrorCode =
  | 'invalid_host'
  | 'invalid_command'
  | 'auth_required'
  | 'host_key'
  | 'ssh_failed'
  | 'not_installed'
  | 'incompatible'
  | 'invalid_output'
  | 'tunnel_failed'
  | 'start_failed'
  | 'health_timeout'
  | 'lease_conflict'
  | 'config_invalid'
  | 'internal'

const ENGINE_ERROR_CODES = new Set<RemoteSshErrorCode>(['start_failed', 'health_timeout', 'lease_conflict', 'config_invalid', 'internal'])
// Transient failures are retried while a connection is being kept alive;
// everything else needs the user to act (keys, install, upgrade, config).
const RETRYABLE_CODES = new Set<RemoteSshErrorCode>(['ssh_failed', 'tunnel_failed', 'start_failed', 'health_timeout'])

export interface SshTarget {
  destination: string
  port: number | null
}

export type AttachOutcome =
  | { ok: true; port: number; token: string; version: string; pid: number | null; miraHome: string | null; started: boolean }
  | { ok: false; code: RemoteSshErrorCode; message: string }

export type RemoteSshPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// Never includes the token: this is what the renderer and logs may see.
export interface RemoteSshStatus {
  phase: RemoteSshPhase
  host: string | null
  localPort: number | null
  version: string | null
  error: { code: RemoteSshErrorCode; message: string } | null
  attempt: number
}

// Accepts an ~/.ssh/config alias, host, user@host, and an optional :port
// (or [ipv6]:port). Anything that could be read as an ssh option is rejected.
export function parseSshTarget(input: string): SshTarget | null {
  const value = input.trim()
  if (!value || value.length > 255 || /\s/.test(value)) return null
  const match = value.match(/^(?:([A-Za-z0-9._][A-Za-z0-9._-]*)@)?(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9_][A-Za-z0-9._-]*))(?::(\d{1,5}))?$/)
  if (!match) return null
  const [, user, ipv6, name, rawPort] = match
  const port = rawPort ? Number(rawPort) : null
  if (port !== null && (port < 1 || port > 65535)) return null
  const host = ipv6 ?? name
  return { destination: user ? `${user}@${host}` : host, port }
}

export function sshExecutable(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync): string {
  if (platform !== 'win32') return 'ssh'
  // Windows 10+ ships OpenSSH here; fall back to PATH lookup otherwise.
  const builtin = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
  return exists(builtin) ? builtin : 'ssh.exe'
}

// BatchMode keeps ssh from ever blocking on a password or host-key prompt we
// cannot show; such cases surface as auth_required / host_key instead.
function baseOptions(target: SshTarget): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    ...(target.port ? ['-p', String(target.port)] : []),
  ]
}

export function buildAttachArgs(target: SshTarget, miraCommand = DEFAULT_MIRA_COMMAND): string[] {
  return [...baseOptions(target), target.destination, '--', attachCommand(miraCommand)]
}

export function buildTunnelArgs(target: SshTarget, localPort: number, remotePort: number): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    ...baseOptions(target),
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    target.destination,
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return (lines.at(-1) ?? '').slice(0, 500)
}

// The engine prints exactly one JSON line and it is the last one; login-shell
// banners (~/.profile) may come before it. Earlier lines are never parsed.
function lastJsonLine(stdout: string): Record<string, unknown> | null {
  const line = lastLine(stdout)
  if (!line.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(line)
    return isRecord(parsed) && 'protocol' in parsed ? parsed : null
  } catch {
    return null
  }
}

export function parseAttachOutput(result: { code: number | null; stdout: string; stderr: string }): AttachOutcome {
  const payload = lastJsonLine(result.stdout)
  if (payload) {
    if (payload.protocol !== REMOTE_PROTOCOL) {
      return { ok: false, code: 'incompatible', message: `Unsupported remote protocol ${String(payload.protocol)}` }
    }
    if (payload.ok === true) {
      const { port, token, version, pid, mira_home: miraHome, started } = payload
      if (
        typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
        || typeof token !== 'string' || !TOKEN_PATTERN.test(token)
        || typeof version !== 'string' || !version
      ) {
        return { ok: false, code: 'invalid_output', message: 'The server returned an incomplete attach response.' }
      }
      return {
        ok: true,
        port,
        token,
        version,
        pid: typeof pid === 'number' && Number.isInteger(pid) ? pid : null,
        miraHome: typeof miraHome === 'string' ? miraHome : null,
        started: started === true,
      }
    }
    const error = isRecord(payload.error) ? payload.error : {}
    const code = typeof error.code === 'string' && ENGINE_ERROR_CODES.has(error.code as RemoteSshErrorCode)
      ? error.code as RemoteSshErrorCode
      : 'internal'
    const message = typeof error.message === 'string' && error.message.trim() ? error.message.trim().slice(0, 500) : 'The remote engine failed to start.'
    return { ok: false, code, message }
  }

  const stderr = result.stderr
  if (result.code === 255) {
    if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
      return { ok: false, code: 'host_key', message: lastLine(stderr) }
    }
    if (/Permission denied|Too many authentication failures|no matching host key|Authentication failed/i.test(stderr)) {
      return { ok: false, code: 'auth_required', message: lastLine(stderr) }
    }
    return { ok: false, code: 'ssh_failed', message: lastLine(stderr) || 'ssh failed' }
  }
  if (result.code === null) {
    return { ok: false, code: 'ssh_failed', message: 'Timed out waiting for the server.' }
  }
  if (result.code === 127 || /not found|No such file or directory/i.test(stderr)) {
    return { ok: false, code: 'not_installed', message: lastLine(stderr) }
  }
  // An engine that predates Remote-SSH has no `remote` command.
  if (/No such command|invalid choice|unrecognized arguments/i.test(stderr)) {
    return { ok: false, code: 'incompatible', message: lastLine(stderr) }
  }
  const unexpected = lastLine(result.stdout) || lastLine(stderr)
  return { ok: false, code: 'invalid_output', message: unexpected ? `Unexpected output from server: ${unexpected}` : 'Unexpected output from server.' }
}

// Host aliases from ~/.ssh/config, in file order. Patterns (*, ?, !) are not
// connectable names and Include files are not followed.
export function parseSshConfigHosts(text: string): string[] {
  const hosts: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const match = line.match(/^Host(?:\s*=\s*|\s+)(.+)$/i)
    if (!match) continue
    for (const name of match[1].split(/\s+/)) {
      const host = name.replace(/^"|"$/g, '')
      if (!host || /[*?!]/.test(host) || !parseSshTarget(host) || hosts.includes(host)) continue
      hosts.push(host)
    }
  }
  return hosts
}

export async function readSshConfigHosts(home: string): Promise<string[]> {
  try {
    return parseSshConfigHosts(await readFile(path.join(home, '.ssh', 'config'), 'utf8'))
  } catch {
    return []
  }
}

export function getFreePort(preferred?: number | null): Promise<number> {
  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : port
      server.close(() => resolve(bound))
    })
  })
  return preferred ? listen(preferred).catch(() => listen(0)) : listen(0)
}

export async function waitForPort(port: number, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      const done = (value: boolean) => { socket.destroy(); resolve(value) }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.setTimeout(intervalMs * 5, () => done(false))
    })
    if (open) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

export interface SshChild {
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
  kill: (signal?: NodeJS.Signals) => boolean
  once(event: 'exit' | 'close', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

export interface RemoteSshDeps {
  executable: string
  spawn: (command: string, args: string[]) => SshChild
  getFreePort: (preferred?: number | null) => Promise<number>
  waitForPort: (port: number, timeoutMs: number) => Promise<boolean>
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  attachTimeoutMs: number
  tunnelReadyTimeoutMs: number
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]
export const MAX_RECONNECT_ATTEMPTS = 10
const OUTPUT_LIMIT = 64 * 1024

export function defaultRemoteSshDeps(log: RemoteSshDeps['log']): RemoteSshDeps {
  return {
    executable: sshExecutable(),
    spawn: (command, args) => nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    getFreePort,
    waitForPort,
    log,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    attachTimeoutMs: 90_000,
    tunnelReadyTimeoutMs: 20_000,
  }
}

export class RemoteSshManager {
  private state: RemoteSshStatus = { phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0 }
  private target: SshTarget | null = null
  private miraCommand = DEFAULT_MIRA_COMMAND
  private token: string | null = null
  private tunnel: SshChild | null = null
  private generation = 0
  private pending: Promise<RemoteSshStatus> | null = null
  private retryTimer: unknown = null
  private listeners = new Set<(status: RemoteSshStatus) => void>()

  constructor(private readonly deps: RemoteSshDeps) {}

  status(): RemoteSshStatus {
    return { ...this.state, error: this.state.error ? { ...this.state.error } : null }
  }

  // Only a live connection hands out its token.
  getToken(): string | null {
    return this.state.phase === 'connected' ? this.token : null
  }

  onStatus(listener: (status: RemoteSshStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // `miraCommand` is the remote path of the mira CLI for this host (default
  // `mira`, e.g. /opt/mira/bin/mira when it is not on the login-shell PATH).
  connect(host: string, options: { miraCommand?: string | null } = {}): Promise<RemoteSshStatus> {
    const target = parseSshTarget(host)
    const miraCommand = parseMiraCommand(options.miraCommand)
    if (!target || !miraCommand) {
      this.stop()
      this.update({ phase: 'error', host: host.trim() || null, localPort: null, version: null, attempt: 0,
        error: target
          ? { code: 'invalid_command', message: 'The remote mira command must be a plain path such as /opt/mira/bin/mira.' }
          : { code: 'invalid_host', message: 'Enter an SSH host alias or user@host[:port].' } })
      return Promise.resolve(this.status())
    }
    const active = this.state.host === host.trim() && this.miraCommand === miraCommand
      && ['connecting', 'connected', 'reconnecting'].includes(this.state.phase)
    if (active) return this.pending ?? Promise.resolve(this.status())
    this.stop()
    this.target = target
    this.miraCommand = miraCommand
    this.update({ phase: 'connecting', host: host.trim(), localPort: null, version: null, error: null, attempt: 0 })
    return this.establish(this.generation)
  }

  disconnect(): RemoteSshStatus {
    this.stop()
    this.target = null
    this.update({ phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0 })
    return this.status()
  }

  // After sleep the forwarded TCP connections are usually dead; rebuild the
  // tunnel right away instead of waiting for ServerAlive to notice.
  handleResume(): void {
    if (!this.target || !['connected', 'reconnecting'].includes(this.state.phase)) return
    const localPort = this.state.localPort
    this.stop()
    this.update({ phase: 'reconnecting', attempt: 0, error: null, localPort })
    void this.establish(this.generation)
  }

  dispose(): void {
    this.stop()
    this.listeners.clear()
  }

  private stop(): void {
    this.generation += 1
    this.pending = null
    this.token = null
    if (this.retryTimer !== null) {
      this.deps.clearTimer(this.retryTimer)
      this.retryTimer = null
    }
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.kill()
  }

  private update(patch: Partial<RemoteSshStatus>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.status()
    for (const listener of this.listeners) listener(snapshot)
  }

  private establish(generation: number): Promise<RemoteSshStatus> {
    const run = this.attachAndForward(generation).finally(() => {
      if (this.pending === run) this.pending = null
    })
    this.pending = run
    return run
  }

  private async attachAndForward(generation: number): Promise<RemoteSshStatus> {
    const target = this.target
    if (!target) return this.status()
    // Every (re)connect re-runs attach and takes port and token from its
    // answer: a server-side restart can move the engine to another port.
    const output = await this.run(buildAttachArgs(target, this.miraCommand), this.deps.attachTimeoutMs)
    if (generation !== this.generation) return this.status()
    const attach = parseAttachOutput(output)
    if (!attach.ok) return this.fail(generation, attach.code, attach.message)

    const localPort = await this.deps.getFreePort(this.state.localPort)
    if (generation !== this.generation) return this.status()
    const tunnel = this.deps.spawn(this.deps.executable, buildTunnelArgs(target, localPort, attach.port))
    this.tunnel = tunnel
    let stderr = ''
    tunnel.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + String(chunk)).slice(-OUTPUT_LIMIT) })
    const exited = new Promise<false>((resolve) => {
      tunnel.once('exit', () => {
        resolve(false)
        this.onTunnelExit(generation, tunnel)
      })
      tunnel.once('error', () => resolve(false))
    })
    const ready = await Promise.race([this.deps.waitForPort(localPort, this.deps.tunnelReadyTimeoutMs), exited])
    if (generation !== this.generation) return this.status()
    if (!ready) {
      this.tunnel = null
      tunnel.kill()
      return this.fail(generation, 'tunnel_failed', lastLine(stderr) || 'Could not forward the engine port over SSH.')
    }
    this.token = attach.token
    this.deps.log('remote_ssh.connected', { phase: 'connected', version: attach.version, operation: attach.started ? 'start' : 'attach' })
    this.update({ phase: 'connected', localPort, version: attach.version, error: null, attempt: 0 })
    return this.status()
  }

  private fail(generation: number, code: RemoteSshErrorCode, message: string): RemoteSshStatus {
    this.token = null
    this.deps.log('remote_ssh.failed', { code, phase: this.state.phase, count: this.state.attempt })
    // Keep retrying a connection the user already had; a first connect
    // reports the error so they can fix keys, install Mira, etc.
    if (this.state.phase === 'reconnecting' && RETRYABLE_CODES.has(code)) {
      this.scheduleReconnect(generation, { code, message })
      return this.status()
    }
    this.update({ phase: 'error', error: { code, message } })
    return this.status()
  }

  private onTunnelExit(generation: number, tunnel: SshChild): void {
    if (generation !== this.generation || tunnel !== this.tunnel) return
    this.tunnel = null
    this.token = null
    if (this.state.phase !== 'connected') return
    this.deps.log('remote_ssh.tunnel_exited', { phase: 'reconnecting' })
    this.update({ phase: 'reconnecting', attempt: 0 })
    this.scheduleReconnect(generation, null)
  }

  private scheduleReconnect(generation: number, error: RemoteSshStatus['error']): void {
    const attempt = this.state.attempt + 1
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      this.update({ phase: 'error', error: error ?? { code: 'ssh_failed', message: 'Lost the connection to the server.' } })
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)]
    this.update({ phase: 'reconnecting', attempt, error })
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null
      if (generation === this.generation) void this.establish(generation)
    }, delay)
  }

  private run(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const child = this.deps.spawn(this.deps.executable, args)
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        this.deps.clearTimer(timer)
        resolve({ code, stdout, stderr })
      }
      const timer = this.deps.setTimer(() => {
        child.kill()
        finish(null)
      }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout = (stdout + String(chunk)).slice(-OUTPUT_LIMIT) })
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + String(chunk)).slice(-OUTPUT_LIMIT) })
      child.once('error', (error) => {
        // ENOENT: no ssh client on this machine.
        stderr += `\n${error.message}`
        finish(255)
      })
      // 'close' fires after stdout/stderr are drained, unlike 'exit'.
      child.once('close', (code) => finish(code))
    })
  }
}
