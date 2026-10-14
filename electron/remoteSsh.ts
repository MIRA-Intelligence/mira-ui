import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { TOKEN_PATTERN } from './engineToken'
import {
  askpassSupported,
  classifyPrompt,
  parseSshVersion,
  PROMPT_TEXT_LIMIT,
  type AskpassSession,
  type PromptHandler,
  type SshPromptRequest,
  type SshVersion,
} from './sshAskpass'

// Remote-SSH (Mode B in MIRA-Intelligence/mira docs/server-edition/architecture.md):
// the system `ssh` starts or attaches the user's engine on the server
// (`mira remote attach --json`, MIRA-Intelligence/mira#166), then forwards a
// local loopback port to it. SSH handles authentication; Mira stores no SSH
// credentials, and the gateway token stays in this process's memory.
//
// Passwords, key passphrases, one-time codes and unknown host keys are asked
// through SSH_ASKPASS (sshAskpass.ts), like VS Code Remote-SSH. On macOS/Linux
// one ControlMaster connection carries both attach and the port forward, so a
// password is asked once per connection. Windows OpenSSH has no ControlMaster:
// attach and the tunnel log in separately and a password is asked twice.

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
  | 'auth_cancelled'
  | 'prompt_unsupported'
  | 'host_key'
  | 'host_key_changed'
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

const portArgs = (target: SshTarget) => (target.port ? ['-p', String(target.port)] : [])
const forwardSpec = (localPort: number, remotePort: number) => `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`
const KEEPALIVE = ['-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']

// Without prompt support BatchMode keeps ssh from ever blocking on a password
// or host-key prompt nobody can answer; such cases surface as auth_required /
// host_key instead. With prompts, ssh asks through SSH_ASKPASS.
function baseOptions(target: SshTarget, interactive: boolean): string[] {
  return [
    ...(interactive ? [] : ['-o', 'BatchMode=yes']),
    '-o', 'ConnectTimeout=15',
    ...portArgs(target),
  ]
}

export function buildAttachArgs(target: SshTarget, miraCommand = DEFAULT_MIRA_COMMAND, interactive = false): string[] {
  return [...baseOptions(target, interactive), target.destination, '--', attachCommand(miraCommand)]
}

export function buildTunnelArgs(target: SshTarget, localPort: number, remotePort: number, interactive = false): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    ...KEEPALIVE,
    ...baseOptions(target, interactive),
    '-L', forwardSpec(localPort, remotePort),
    target.destination,
  ]
}

// The long-lived, authenticated connection (macOS/Linux). It stays in the
// foreground as our child, so its exit means the connection is gone.
export function buildMasterArgs(target: SshTarget, controlPath: string): string[] {
  return [
    '-N',
    '-o', 'ControlMaster=yes',
    '-o', `ControlPath=${controlPath}`,
    '-o', 'ControlPersist=no',
    ...KEEPALIVE,
    ...baseOptions(target, true),
    target.destination,
  ]
}

// Clients of the master never authenticate: BatchMode stops a client whose
// master is gone from silently opening (and prompting for) a new connection.
function muxOptions(target: SshTarget, controlPath: string): string[] {
  return ['-o', 'ControlMaster=no', '-o', `ControlPath=${controlPath}`, '-o', 'BatchMode=yes', ...portArgs(target)]
}

export function buildMuxAttachArgs(target: SshTarget, controlPath: string, miraCommand = DEFAULT_MIRA_COMMAND): string[] {
  return [...muxOptions(target, controlPath), target.destination, '--', attachCommand(miraCommand)]
}

// The forward lives in the master and ends with it.
export function buildMuxForwardArgs(target: SshTarget, controlPath: string, operation: 'forward' | 'cancel', localPort: number, remotePort: number): string[] {
  return [...muxOptions(target, controlPath), '-O', operation, '-L', forwardSpec(localPort, remotePort), target.destination]
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

// ssh itself failed (exit 255) or never finished (null).
export function classifySshFailure(code: number | null, stderr: string): Extract<AttachOutcome, { ok: false }> {
  if (code === null) return { ok: false, code: 'ssh_failed', message: 'Timed out waiting for the server.' }
  // A changed key may mean an attack; it is never accepted from the app.
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(stderr)) {
    return { ok: false, code: 'host_key_changed', message: 'The server host key has changed.' }
  }
  if (/Host key verification failed/i.test(stderr)) {
    return { ok: false, code: 'host_key', message: lastLine(stderr) }
  }
  if (/Permission denied|Too many authentication failures|no matching host key|Authentication failed/i.test(stderr)) {
    return { ok: false, code: 'auth_required', message: lastLine(stderr) }
  }
  return { ok: false, code: 'ssh_failed', message: lastLine(stderr) || 'ssh failed' }
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
  if (result.code === 255 || result.code === null) return classifySshFailure(result.code, stderr)
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

export async function waitForFile(file: string, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

export function detectSshVersion(executable: string): Promise<SshVersion | null> {
  return new Promise((resolve) => {
    execFile(executable, ['-V'], { timeout: 5000, windowsHide: true }, (_error, stdout, stderr) => {
      resolve(parseSshVersion(`${stderr}\n${stdout}`))
    })
  })
}

export interface RemoteSshDeps {
  executable: string
  platform: NodeJS.Platform
  // `env` is added to the inherited environment (askpass variables).
  spawn: (command: string, args: string[], env?: Record<string, string>) => SshChild
  getFreePort: (preferred?: number | null) => Promise<number>
  waitForPort: (port: number, timeoutMs: number) => Promise<boolean>
  waitForFile: (file: string, timeoutMs: number) => Promise<boolean>
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  attachTimeoutMs: number
  tunnelReadyTimeoutMs: number
  // Covers the time the user spends answering prompts.
  loginTimeoutMs: number
  // Interactive prompts. Without them ssh runs in BatchMode (key-only login).
  openAskpass?: (handler: PromptHandler) => Promise<AskpassSession>
  prompt?: (request: SshPromptRequest, signal: AbortSignal) => Promise<string | null>
  // Private directory for ControlMaster sockets; without it every ssh
  // process logs in on its own.
  controlDir?: () => Promise<string>
  sshVersion?: () => Promise<SshVersion | null>
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]
export const MAX_RECONNECT_ATTEMPTS = 10
const OUTPUT_LIMIT = 64 * 1024
// After sleep, a quick attach over the surviving master tells whether the
// connection still works before anyone is asked to log in again.
const RESUME_CHECK_MS = 20_000
const MUX_COMMAND_MS = 15_000
// ssh-level failures mean the master connection itself is unusable.
const CONNECTION_CODES = new Set<RemoteSshErrorCode>(['ssh_failed', 'auth_required', 'host_key', 'host_key_changed'])

export function defaultRemoteSshDeps(log: RemoteSshDeps['log']): RemoteSshDeps {
  const executable = sshExecutable()
  return {
    executable,
    platform: process.platform,
    // Own session on macOS/Linux: without a controlling terminal every
    // OpenSSH release asks through SSH_ASKPASS instead of /dev/tty.
    spawn: (command, args, env) => nodeSpawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: env ? { ...process.env, ...env } : process.env,
    }),
    getFreePort,
    waitForPort,
    waitForFile,
    log,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    attachTimeoutMs: 90_000,
    tunnelReadyTimeoutMs: 20_000,
    loginTimeoutMs: 300_000,
    sshVersion: () => detectSshVersion(executable),
  }
}

interface ConnectMode {
  interactive: boolean
  multiplex: boolean
  version: SshVersion | null
}

export class RemoteSshManager {
  private state: RemoteSshStatus = { phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0 }
  private target: SshTarget | null = null
  private miraCommand = DEFAULT_MIRA_COMMAND
  private token: string | null = null
  // Direct mode: the `ssh -N -L` tunnel. Multiplexed mode: the master.
  private tunnel: SshChild | null = null
  private master: SshChild | null = null
  private controlPath: string | null = null
  private forward: { local: number; remote: number } | null = null
  private readonly children = new Set<SshChild>()
  private generation = 0
  private sequence = 0
  private pending: Promise<RemoteSshStatus> | null = null
  private retryTimer: unknown = null
  private abort: AbortController | null = null
  private cancelled = false
  private seenPrompts = new Set<string>()
  private modePromise: Promise<ConnectMode> | null = null
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

  // After sleep the forwarded TCP connections are usually dead. A master that
  // survived is checked with a quick attach (no new login); anything else is
  // rebuilt right away instead of waiting for ServerAlive to notice.
  handleResume(): void {
    if (!this.target || !['connected', 'reconnecting'].includes(this.state.phase)) return
    if (this.state.phase === 'connected' && this.master && this.controlPath) {
      this.update({ phase: 'reconnecting', attempt: 0, error: null })
      void this.establish(this.generation, true)
      return
    }
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
    this.abort?.abort()
    this.abort = null
    if (this.retryTimer !== null) {
      this.deps.clearTimer(this.retryTimer)
      this.retryTimer = null
    }
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.kill()
    this.dropMaster()
    for (const child of this.children) child.kill()
    this.children.clear()
  }

  private dropMaster(): void {
    const master = this.master
    this.master = null
    this.controlPath = null
    this.forward = null
    master?.kill()
  }

  private update(patch: Partial<RemoteSshStatus>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.status()
    for (const listener of this.listeners) listener(snapshot)
  }

  private establish(generation: number, resuming = false): Promise<RemoteSshStatus> {
    const run = this.connectOnce(generation, resuming).finally(() => {
      if (this.pending === run) this.pending = null
    })
    this.pending = run
    return run
  }

  private mode(): Promise<ConnectMode> {
    this.modePromise ??= (async () => {
      if (!this.deps.openAskpass || !this.deps.prompt) return { interactive: false, multiplex: false, version: null }
      const version = this.deps.sshVersion ? await this.deps.sshVersion().catch(() => null) : null
      const interactive = askpassSupported(this.deps.platform, version)
      // Windows OpenSSH has no ControlMaster support.
      return { interactive, multiplex: interactive && this.deps.platform !== 'win32' && Boolean(this.deps.controlDir), version }
    })()
    return this.modePromise
  }

  private async connectOnce(generation: number, resuming: boolean): Promise<RemoteSshStatus> {
    if (!this.target) return this.status()
    const mode = await this.mode()
    if (generation !== this.generation) return this.status()
    // A live master is reused: no new login, no prompt.
    if (mode.multiplex && this.master && this.controlPath) return this.attachOverMaster(generation, resuming)

    this.abort = new AbortController()
    this.cancelled = false
    this.seenPrompts = new Set()
    let askpass: AskpassSession | null = null
    try {
      askpass = mode.interactive ? await this.deps.openAskpass!((text) => this.onPrompt(generation, text)) : null
      if (generation !== this.generation) return this.status()
      return mode.multiplex
        ? await this.loginMaster(generation, askpass!.env)
        : await this.attachAndForward(generation, mode, askpass?.env)
    } finally {
      askpass?.dispose()
    }
  }

  private async onPrompt(generation: number, text: string): Promise<string | null> {
    const signal = this.abort?.signal
    if (generation !== this.generation || !signal || !this.deps.prompt) return null
    const key = text.trim()
    const retry = this.seenPrompts.has(key)
    this.seenPrompts.add(key)
    const kind = classifyPrompt(text)
    this.deps.log('remote_ssh.prompt', { kind, retry })
    const answer = await this.deps.prompt({ host: this.state.host ?? '', kind, text: text.slice(0, PROMPT_TEXT_LIMIT), retry }, signal)
    if (answer === null && generation === this.generation) {
      // Cancelled (or timed out): stop ssh instead of letting it retry.
      this.cancelled = true
      this.tunnel?.kill()
      this.master?.kill()
      for (const child of this.children) child.kill()
    }
    return answer
  }

  private async loginMaster(generation: number, env: Record<string, string>): Promise<RemoteSshStatus> {
    const target = this.target!
    const controlPath = path.join(await this.deps.controlDir!(), `m${++this.sequence}`)
    if (generation !== this.generation) return this.status()
    const master = this.deps.spawn(this.deps.executable, buildMasterArgs(target, controlPath), env)
    this.master = master
    let stderr = ''
    let exitCode: number | null = null
    master.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + String(chunk)).slice(-OUTPUT_LIMIT) })
    const exited = new Promise<false>((resolve) => {
      master.once('exit', (code) => {
        exitCode = code ?? 255
        resolve(false)
        this.onConnectionExit(generation, master)
      })
      master.once('error', (error) => {
        stderr += `\n${error.message}`
        exitCode = 255
        resolve(false)
      })
    })
    // The control socket appears only after a successful login.
    const ready = await Promise.race([this.deps.waitForFile(controlPath, this.deps.loginTimeoutMs), exited])
    if (generation !== this.generation) return this.status()
    if (!ready) {
      if (this.master === master) this.dropMaster()
      if (this.cancelled) return this.fail(generation, 'auth_cancelled', 'Login cancelled.')
      const failure = classifySshFailure(exitCode, stderr)
      return this.fail(generation, failure.code, failure.message)
    }
    this.controlPath = controlPath
    return this.attachOverMaster(generation, false)
  }

  private async attachOverMaster(generation: number, resuming: boolean): Promise<RemoteSshStatus> {
    const target = this.target!
    const controlPath = this.controlPath!
    // Every (re)connect re-runs attach and takes port and token from its
    // answer: a server-side restart can move the engine to another port.
    const output = await this.run(buildMuxAttachArgs(target, controlPath, this.miraCommand), resuming ? RESUME_CHECK_MS : this.deps.attachTimeoutMs)
    if (generation !== this.generation) return this.status()
    const attach = parseAttachOutput(output)
    if (!attach.ok) {
      if (CONNECTION_CODES.has(attach.code)) this.dropMaster()
      return this.fail(generation, attach.code, attach.message)
    }
    if (this.forward && this.forward.remote !== attach.port) {
      await this.run(buildMuxForwardArgs(target, controlPath, 'cancel', this.forward.local, this.forward.remote), MUX_COMMAND_MS)
      this.forward = null
      if (generation !== this.generation) return this.status()
    }
    if (!this.forward) {
      const localPort = await this.deps.getFreePort(this.state.localPort)
      if (generation !== this.generation) return this.status()
      const result = await this.run(buildMuxForwardArgs(target, controlPath, 'forward', localPort, attach.port), MUX_COMMAND_MS)
      if (generation !== this.generation) return this.status()
      if (result.code !== 0) return this.fail(generation, 'tunnel_failed', lastLine(result.stderr) || 'Could not forward the engine port over SSH.')
      this.forward = { local: localPort, remote: attach.port }
    }
    const localPort = this.forward.local
    const ready = await this.deps.waitForPort(localPort, this.deps.tunnelReadyTimeoutMs)
    if (generation !== this.generation) return this.status()
    if (!ready) {
      this.dropMaster()
      return this.fail(generation, 'tunnel_failed', 'Could not forward the engine port over SSH.')
    }
    return this.connected(attach, localPort)
  }

  private async attachAndForward(generation: number, mode: ConnectMode, env?: Record<string, string>): Promise<RemoteSshStatus> {
    const target = this.target!
    // Every (re)connect re-runs attach and takes port and token from its
    // answer: a server-side restart can move the engine to another port.
    const output = await this.run(buildAttachArgs(target, this.miraCommand, mode.interactive), this.deps.attachTimeoutMs + (mode.interactive ? this.deps.loginTimeoutMs : 0), env)
    if (generation !== this.generation) return this.status()
    if (this.cancelled) return this.fail(generation, 'auth_cancelled', 'Login cancelled.')
    const attach = parseAttachOutput(output)
    if (!attach.ok) {
      // Windows OpenSSH too old for prompts: say why a password cannot work.
      if (attach.code === 'auth_required' && !mode.interactive && this.deps.openAskpass) {
        return this.fail(generation, 'prompt_unsupported', mode.version?.raw ?? 'unknown OpenSSH version')
      }
      return this.fail(generation, attach.code, attach.message)
    }

    const localPort = await this.deps.getFreePort(this.state.localPort)
    if (generation !== this.generation) return this.status()
    const tunnel = this.deps.spawn(this.deps.executable, buildTunnelArgs(target, localPort, attach.port, mode.interactive), env)
    this.tunnel = tunnel
    let stderr = ''
    tunnel.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + String(chunk)).slice(-OUTPUT_LIMIT) })
    const exited = new Promise<false>((resolve) => {
      tunnel.once('exit', () => {
        resolve(false)
        this.onConnectionExit(generation, tunnel)
      })
      tunnel.once('error', () => resolve(false))
    })
    const readyTimeout = this.deps.tunnelReadyTimeoutMs + (mode.interactive ? this.deps.loginTimeoutMs : 0)
    const ready = await Promise.race([this.deps.waitForPort(localPort, readyTimeout), exited])
    if (generation !== this.generation) return this.status()
    if (!ready) {
      this.tunnel = null
      tunnel.kill()
      if (this.cancelled) return this.fail(generation, 'auth_cancelled', 'Login cancelled.')
      return this.fail(generation, 'tunnel_failed', lastLine(stderr) || 'Could not forward the engine port over SSH.')
    }
    return this.connected(attach, localPort)
  }

  private connected(attach: Extract<AttachOutcome, { ok: true }>, localPort: number): RemoteSshStatus {
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

  private onConnectionExit(generation: number, child: SshChild): void {
    if (generation !== this.generation) return
    if (child === this.tunnel) this.tunnel = null
    else if (child === this.master) {
      this.master = null
      this.controlPath = null
      this.forward = null
    } else return
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

  private run(args: string[], timeoutMs: number, env?: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const child = this.deps.spawn(this.deps.executable, args, env)
      this.children.add(child)
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        this.children.delete(child)
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
