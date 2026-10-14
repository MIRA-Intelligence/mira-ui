// Renderer side of Remote-SSH (electron/remoteSsh.ts). The main process owns
// the ssh processes and the gateway token; the renderer only sees status and
// talks to the engine through the forwarded loopback port.

export type RemoteSshPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

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
  // The engine on the server predates Remote-SSH: offer to install/upgrade.
  | 'too_old'
  // The engine speaks a newer protocol than this app.
  | 'incompatible'
  | 'invalid_output'
  | 'tunnel_failed'
  | 'start_failed'
  | 'health_timeout'
  | 'lease_conflict'
  | 'config_invalid'
  | 'internal'
  | 'unavailable'

export interface RemoteSshStatus {
  phase: RemoteSshPhase
  host: string | null
  localPort: number | null
  version: string | null
  error: { code: RemoteSshErrorCode; message: string } | null
  attempt: number
  // The remote mira executable the last attach used (manual or discovered).
  miraPath: string | null
}

export const IDLE_REMOTE_SSH_STATUS: RemoteSshStatus = {
  phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0, miraPath: null,
}

const PHASES = new Set<RemoteSshPhase>(['idle', 'connecting', 'connected', 'reconnecting', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeRemoteSshStatus(value: unknown): RemoteSshStatus {
  if (!isRecord(value) || !PHASES.has(value.phase as RemoteSshPhase)) return IDLE_REMOTE_SSH_STATUS
  const localPort = typeof value.localPort === 'number' && Number.isInteger(value.localPort) && value.localPort > 0 && value.localPort < 65536
    ? value.localPort
    : null
  const error = isRecord(value.error) && typeof value.error.code === 'string'
    ? { code: value.error.code as RemoteSshErrorCode, message: typeof value.error.message === 'string' ? value.error.message : '' }
    : null
  return {
    phase: value.phase as RemoteSshPhase,
    host: typeof value.host === 'string' ? value.host : null,
    localPort,
    version: typeof value.version === 'string' ? value.version : null,
    error,
    attempt: typeof value.attempt === 'number' ? value.attempt : 0,
    miraPath: typeof value.miraPath === 'string' && value.miraPath ? value.miraPath : null,
  }
}

export function tunnelEndpoints(localPort: number): { apiUrl: string; wsUrl: string } {
  return {
    apiUrl: `http://127.0.0.1:${localPort}/api`,
    wsUrl: `ws://127.0.0.1:${localPort}/ws`,
  }
}

export function hasRemoteSshBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.remoteSshConnect === 'function'
}

const unavailable: RemoteSshStatus = {
  ...IDLE_REMOTE_SSH_STATUS,
  phase: 'error',
  error: { code: 'unavailable', message: 'Remote-SSH requires the MIRA desktop app.' },
}

// Default remote CLI; a host can override it (e.g. /opt/mira/bin/mira) when
// `mira` is not on the login-shell PATH there.
export const DEFAULT_MIRA_COMMAND = 'mira'

export async function connectRemoteSsh(host: string, miraCommand?: string): Promise<RemoteSshStatus> {
  if (!hasRemoteSshBridge()) return unavailable
  const command = miraCommand?.trim() || undefined
  return sanitizeRemoteSshStatus(await window.electronAPI!.remoteSshConnect!(host, command))
}

export async function disconnectRemoteSsh(): Promise<RemoteSshStatus> {
  if (!hasRemoteSshBridge()) return IDLE_REMOTE_SSH_STATUS
  return sanitizeRemoteSshStatus(await window.electronAPI!.remoteSshDisconnect!())
}

export async function getRemoteSshStatus(): Promise<RemoteSshStatus> {
  if (!hasRemoteSshBridge()) return IDLE_REMOTE_SSH_STATUS
  return sanitizeRemoteSshStatus(await window.electronAPI!.remoteSshStatus!())
}

export async function listSshHosts(): Promise<string[]> {
  const hosts = await window.electronAPI?.listSshHosts?.().catch(() => [])
  return Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === 'string') : []
}

export function onRemoteSshStatus(listener: (status: RemoteSshStatus) => void): () => void {
  const subscribe = window.electronAPI?.onRemoteSshStatus
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((status) => listener(sanitizeRemoteSshStatus(status)))
}

// A question ssh needs answered while logging in (askpass). host_key: an
// unknown server key to confirm; secret: password, passphrase or one-time code.
export type SshPromptKind = 'host_key' | 'secret'

export interface SshPrompt {
  id: string
  host: string
  kind: SshPromptKind
  text: string
  retry: boolean
}

export function sanitizeSshPrompt(value: unknown): SshPrompt | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.text !== 'string') return null
  return {
    id: value.id,
    host: typeof value.host === 'string' ? value.host : '',
    kind: value.kind === 'host_key' ? 'host_key' : 'secret',
    text: value.text.slice(0, 4000),
    retry: value.retry === true,
  }
}

export function onSshPrompt(listener: (prompt: SshPrompt) => void): () => void {
  const subscribe = window.electronAPI?.onRemoteSshPrompt
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((value) => {
    const prompt = sanitizeSshPrompt(value)
    if (prompt) listener(prompt)
  })
}

export function onSshPromptCancel(listener: (id: string) => void): () => void {
  const subscribe = window.electronAPI?.onRemoteSshPromptCancel
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((value) => {
    if (isRecord(value) && typeof value.id === 'string') listener(value.id)
  })
}

// null cancels the login.
export async function answerSshPrompt(id: string, answer: string | null): Promise<boolean> {
  const respond = window.electronAPI?.answerRemoteSshPrompt
  if (typeof respond !== 'function') return false
  return respond(id, answer).catch(() => false)
}

// ---------------------------------------------------------------------------
// Installing Mira on the server (electron/remoteSsh.ts install()). The main
// process runs it only when the renderer asks, which it does only after the
// user pressed Install in RemoteInstallDialog.

export interface RemoteInstallPlan {
  spec: string
  venv: string
  script: string
  defaultSpec: boolean
}

export type RemoteInstallErrorCode =
  | 'no_python'
  | 'too_old'
  | 'install_failed'
  | 'cancelled'
  | 'timeout'
  | 'busy'
  | 'not_ready'
  | 'auth_required'
  | 'auth_cancelled'
  | 'host_key'
  | 'host_key_changed'
  | 'ssh_failed'
  | 'unavailable'

export type RemoteInstallOutcome =
  | { ok: true; version: string | null; launcher: string | null }
  | { ok: false; code: RemoteInstallErrorCode; message: string; version: string | null }

const INSTALL_ERROR_CODES = new Set<RemoteInstallErrorCode>([
  'no_python', 'too_old', 'install_failed', 'cancelled', 'timeout', 'busy', 'not_ready',
  'auth_required', 'auth_cancelled', 'host_key', 'host_key_changed', 'ssh_failed', 'unavailable',
])

const stringOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null)

export function sanitizeInstallPlan(value: unknown): RemoteInstallPlan | null {
  if (!isRecord(value) || typeof value.spec !== 'string' || typeof value.venv !== 'string' || typeof value.script !== 'string') return null
  return { spec: value.spec, venv: value.venv, script: value.script, defaultSpec: value.defaultSpec === true }
}

export function sanitizeInstallOutcome(value: unknown): RemoteInstallOutcome {
  if (isRecord(value) && value.ok === true) {
    return { ok: true, version: stringOrNull(value.version), launcher: stringOrNull(value.launcher) }
  }
  const record = isRecord(value) ? value : {}
  const code = INSTALL_ERROR_CODES.has(record.code as RemoteInstallErrorCode) ? record.code as RemoteInstallErrorCode : 'install_failed'
  return { ok: false, code, message: typeof record.message === 'string' ? record.message : '', version: stringOrNull(record.version) }
}

export async function getRemoteInstallPlan(): Promise<RemoteInstallPlan | null> {
  const plan = window.electronAPI?.getRemoteInstallPlan
  if (typeof plan !== 'function') return null
  return sanitizeInstallPlan(await plan().catch(() => null))
}

export async function installRemoteMira(): Promise<RemoteInstallOutcome> {
  const install = window.electronAPI?.installRemoteMira
  if (typeof install !== 'function') return { ok: false, code: 'unavailable', message: '', version: null }
  try {
    return sanitizeInstallOutcome(await install())
  } catch (error) {
    return { ok: false, code: 'install_failed', message: error instanceof Error ? error.message : String(error), version: null }
  }
}

export async function cancelRemoteInstall(): Promise<boolean> {
  const cancel = window.electronAPI?.cancelRemoteInstall
  if (typeof cancel !== 'function') return false
  return cancel().catch(() => false)
}

export function onRemoteInstallOutput(listener: (chunk: string) => void): () => void {
  const subscribe = window.electronAPI?.onRemoteInstallOutput
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((chunk) => {
    if (typeof chunk === 'string') listener(chunk)
  })
}
