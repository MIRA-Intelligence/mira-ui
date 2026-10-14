// Shapes exchanged between the Electron main process (electron/teamServer.ts)
// and the renderer for Mira Server sign-in. The refresh token never appears
// here: it stays in the main process.

export const TEAM_SERVER_PROTOCOL = 1

export interface TeamServerUser {
  name: string
  displayName: string
  roles: string[]
}

export interface TeamServerSession {
  accessToken: string
  // Seconds until the access token expires, counted from when it was issued.
  expiresIn: number
  user: TeamServerUser
  // False when the refresh token could not be encrypted (no OS keychain) and
  // is kept in memory only: the user signs in again at the next launch.
  persistent: boolean
}

export interface TeamServerInfo {
  version: string | null
  protocol: number
  methods: string[]
}

export type TeamServerErrorCode =
  | 'invalid_url'
  | 'not_mira_server'
  | 'protocol_unsupported'
  | 'invalid_credentials'
  | 'forbidden'
  | 'too_many_attempts'
  | 'signed_out'
  | 'network'
  | 'tls'
  | 'timeout'
  | 'server_error'
  | 'invalid_response'
  | 'unavailable'

export interface TeamServerFailure {
  ok: false
  code: TeamServerErrorCode
  // Server-provided explanation, if any (never contains credentials).
  message: string
  status: number | null
  retryAfter: number | null
}

export type TeamServerInfoResult = ({ ok: true } & TeamServerInfo) | TeamServerFailure
export type TeamServerSessionResult = { ok: true; session: TeamServerSession } | TeamServerFailure

export type TeamServerSessionReason = 'login' | 'refresh' | 'logout' | 'expired'

export interface TeamServerSessionEvent {
  origin: string
  session: TeamServerSession | null
  reason: TeamServerSessionReason
}

const ERROR_CODES = new Set<TeamServerErrorCode>([
  'invalid_url', 'not_mira_server', 'protocol_unsupported', 'invalid_credentials', 'forbidden',
  'too_many_attempts', 'signed_out', 'network', 'tls', 'timeout', 'server_error', 'invalid_response',
  'unavailable',
])

const REASONS = new Set<TeamServerSessionReason>(['login', 'refresh', 'logout', 'expired'])

export const MAX_MESSAGE_LENGTH = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAdmin(user: TeamServerUser | null | undefined): boolean {
  return Boolean(user?.roles.includes('admin'))
}

// Accepts both the wire format ({name, display_name, roles}) and the IPC one.
export function sanitizeTeamServerUser(value: unknown): TeamServerUser | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) return null
  const display = typeof value.displayName === 'string' ? value.displayName
    : typeof value.display_name === 'string' ? value.display_name : ''
  const roles = Array.isArray(value.roles)
    ? value.roles.filter((role): role is string => typeof role === 'string' && role.length <= 64).slice(0, 16)
    : []
  return { name: value.name.slice(0, 256), displayName: display.slice(0, 256), roles }
}

export function sanitizeTeamServerSession(value: unknown): TeamServerSession | null {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || !value.accessToken) return null
  const user = sanitizeTeamServerUser(value.user)
  const expiresIn = typeof value.expiresIn === 'number' && Number.isFinite(value.expiresIn) && value.expiresIn > 0
    ? value.expiresIn
    : null
  if (!user || expiresIn === null) return null
  return { accessToken: value.accessToken, expiresIn, user, persistent: value.persistent === true }
}

export function failure(code: TeamServerErrorCode, message = '', status: number | null = null, retryAfter: number | null = null): TeamServerFailure {
  return { ok: false, code, message: message.slice(0, MAX_MESSAGE_LENGTH), status, retryAfter }
}

export function sanitizeTeamServerFailure(value: unknown): TeamServerFailure {
  if (!isRecord(value)) return failure('unavailable')
  const code = ERROR_CODES.has(value.code as TeamServerErrorCode) ? value.code as TeamServerErrorCode : 'server_error'
  return failure(
    code,
    typeof value.message === 'string' ? value.message : '',
    typeof value.status === 'number' ? value.status : null,
    typeof value.retryAfter === 'number' && Number.isFinite(value.retryAfter) ? value.retryAfter : null,
  )
}

export function sanitizeSessionResult(value: unknown): TeamServerSessionResult {
  if (isRecord(value) && value.ok === true) {
    const session = sanitizeTeamServerSession(value.session)
    return session ? { ok: true, session } : failure('invalid_response')
  }
  return sanitizeTeamServerFailure(value)
}

export function sanitizeInfoResult(value: unknown): TeamServerInfoResult {
  if (isRecord(value) && value.ok === true && typeof value.protocol === 'number') {
    return {
      ok: true,
      version: typeof value.version === 'string' ? value.version : null,
      protocol: value.protocol,
      methods: Array.isArray(value.methods) ? value.methods.filter((m): m is string => typeof m === 'string') : [],
    }
  }
  return sanitizeTeamServerFailure(value)
}

export function sanitizeSessionEvent(value: unknown): TeamServerSessionEvent | null {
  if (!isRecord(value) || typeof value.origin !== 'string' || !REASONS.has(value.reason as TeamServerSessionReason)) return null
  return {
    origin: value.origin,
    session: value.session === null ? null : sanitizeTeamServerSession(value.session),
    reason: value.reason as TeamServerSessionReason,
  }
}
