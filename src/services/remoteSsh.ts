// Renderer side of Remote-SSH (electron/remoteSsh.ts). The main process owns
// the ssh processes and the gateway token; the renderer only sees status and
// talks to the engine through the forwarded loopback port.

export type RemoteSshPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

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
  | 'unavailable'

export interface RemoteSshStatus {
  phase: RemoteSshPhase
  host: string | null
  localPort: number | null
  version: string | null
  error: { code: RemoteSshErrorCode; message: string } | null
  attempt: number
}

export const IDLE_REMOTE_SSH_STATUS: RemoteSshStatus = {
  phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0,
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
