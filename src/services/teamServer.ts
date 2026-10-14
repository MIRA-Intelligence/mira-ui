// Renderer side of Team server (Mira Server) mode. Sign-in and token refresh
// happen in the Electron main process (electron/teamServer.ts); this module
// keeps the short-lived access token in memory for request headers, the same
// way engine tokens are handled (services/engineAuth.ts).
import { t } from '@/i18n'
import type { Language } from '@/stores/settingsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { requestTeamServerLogin, useTeamServerStore, type TeamServerEngine, type TeamServerEngineState } from '@/stores/teamServerStore'
import { serverHost, serverOrigin, type ServerUrlError } from '@/lib/teamServerUrl'
import {
  failure,
  sanitizeInfoResult,
  sanitizeSessionEvent,
  sanitizeSessionResult,
  sanitizeTeamServerUser,
  type TeamServerFailure,
  type TeamServerInfoResult,
  type TeamServerSession,
  type TeamServerSessionEvent,
  type TeamServerSessionResult,
} from '@/lib/teamServerProtocol'

let accessToken: string | null = null
let tokenOrigin: string | null = null
// Single-flight per server: concurrent callers share one IPC round trip.
const sessionReads = new Map<string, Promise<TeamServerSessionResult>>()
const refreshReads = new Map<string, Promise<string | null>>()

function api() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export function hasTeamServerBridge(): boolean {
  return typeof api()?.teamServerSession === 'function'
}

const unavailable = (): TeamServerFailure => failure('unavailable')

// The Mira Server origin of the active Team server profile, if any.
export function activeTeamServerOrigin(): string | null {
  const settings = useSettingsStore.getState()
  return settings.deploymentMode === 'teamServer' ? serverOrigin(settings.serverUrl) : null
}

export function teamServerAccessToken(origin: string): string | null {
  return tokenOrigin === origin ? accessToken : null
}

function adopt(origin: string, session: TeamServerSession, fresh = false): void {
  accessToken = session.accessToken
  tokenOrigin = origin
  useTeamServerStore.getState().setSignedIn(origin, session.user, session.persistent, fresh)
}

function signedOut(origin: string): void {
  if (tokenOrigin === origin) {
    accessToken = null
    tokenOrigin = null
  }
  useTeamServerStore.getState().setSignedOut(origin)
}

export function forgetTeamServerAccess(): void {
  accessToken = null
  tokenOrigin = null
  sessionReads.clear()
  refreshReads.clear()
}

export async function fetchTeamServerInfo(origin: string): Promise<TeamServerInfoResult> {
  const info = api()?.teamServerInfo
  if (typeof info !== 'function') return unavailable()
  try {
    return sanitizeInfoResult(await info(origin))
  } catch {
    return unavailable()
  }
}

export async function loginTeamServer(origin: string, username: string, password: string): Promise<TeamServerSessionResult> {
  const login = api()?.teamServerLogin
  if (typeof login !== 'function') return unavailable()
  let result: TeamServerSessionResult
  try {
    result = sanitizeSessionResult(await login(origin, username, password))
  } catch {
    return unavailable()
  }
  if (result.ok) adopt(origin, result.session, true)
  return result
}

// The access token for this server, using the stored refresh token silently.
// Never opens the sign-in dialog: with no stored session the app shows
// "Signed out" and waits for the user (like a Remote-SSH Disconnect).
export function ensureTeamServerSession(origin: string): Promise<TeamServerSessionResult> {
  const read = api()?.teamServerSession
  if (typeof read !== 'function') return Promise.resolve(unavailable())
  const inflight = sessionReads.get(origin)
  if (inflight) return inflight
  const pending = read(origin)
    .then(sanitizeSessionResult)
    .catch(() => unavailable())
    .then((result) => {
      sessionReads.delete(origin)
      if (result.ok) adopt(origin, result.session)
      else if (result.code === 'signed_out' || result.code === 'forbidden') signedOut(origin)
      return result
    })
  sessionReads.set(origin, pending)
  return pending
}

// After a 401: one refresh for all callers. When it fails because the session
// is gone, the sign-in dialog is shown.
export function refreshTeamServerAccess(origin: string, rejected: string | null): Promise<string | null> {
  const refresh = api()?.teamServerRefresh
  if (typeof refresh !== 'function') return Promise.resolve(null)
  const inflight = refreshReads.get(origin)
  if (inflight) return inflight
  const pending = refresh(origin, rejected)
    .then(sanitizeSessionResult)
    .catch(() => unavailable())
    .then((result) => {
      refreshReads.delete(origin)
      if (result.ok) {
        adopt(origin, result.session)
        return result.session.accessToken
      }
      if (result.code === 'signed_out' || result.code === 'forbidden') {
        signedOut(origin)
        if (activeTeamServerOrigin() === origin) void requestTeamServerLogin(origin, 'expired')
      }
      return null
    })
  refreshReads.set(origin, pending)
  return pending
}

export async function logoutTeamServer(origin: string): Promise<boolean> {
  const logout = api()?.teamServerLogout
  signedOut(origin)
  if (typeof logout !== 'function') return false
  return logout(origin).catch(() => false)
}

// Pushed by the main process after sign-in, proactive refresh and sign-out.
// A new access token is adopted without touching an open WebSocket.
export function onTeamServerSession(listener: (event: TeamServerSessionEvent) => void): () => void {
  const subscribe = api()?.onTeamServerSession
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((value) => {
    const event = sanitizeSessionEvent(value)
    if (!event) return
    // Only an explicit sign-in (loginTeamServer) restarts the connection.
    if (event.session) adopt(event.origin, event.session)
    else signedOut(event.origin)
    listener(event)
  })
}

// ---------------------------------------------------------------------------
// /server/me and engine state (window.fetch is wrapped by installEngineAuth,
// which adds the access token and refreshes once on 401).

const ENGINE_STATES = new Set<TeamServerEngineState>(['stopped', 'starting', 'running', 'error', 'conflict'])

function sanitizeEngine(value: unknown): TeamServerEngine | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!ENGINE_STATES.has(record.state as TeamServerEngineState)) return null
  return {
    state: record.state as TeamServerEngineState,
    version: typeof record.version === 'string' ? record.version : null,
    message: typeof record.message === 'string' ? record.message.slice(0, 500) : null,
  }
}

export async function fetchTeamServerMe(origin: string): Promise<TeamServerEngine | null> {
  try {
    const response = await fetch(`${origin}/server/me`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const body = await response.json() as Record<string, unknown>
    const store = useTeamServerStore.getState()
    const user = sanitizeTeamServerUser(body.user)
    if (user && store.phase === 'signedIn' && store.origin === origin) store.setSignedIn(origin, user, store.persistent)
    const engine = sanitizeEngine(body.engine)
    store.setEngine(engine)
    return engine
  } catch {
    return null
  }
}

export async function startTeamServerEngine(origin: string): Promise<TeamServerEngine | null> {
  try {
    const response = await fetch(`${origin}/server/engine/start`, { method: 'POST', headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const engine = sanitizeEngine(await response.json())
    useTeamServerStore.getState().setEngine(engine)
    return engine
  } catch {
    return null
  }
}

// After the WebSocket closed: check the session (a 401 here refreshes once
// through the fetch wrapper) and start an engine that was stopped while idle,
// so the next reconnect finds it.
export async function checkTeamServerAfterDisconnect(): Promise<void> {
  const origin = activeTeamServerOrigin()
  if (!origin || useTeamServerStore.getState().phase !== 'signedIn') return
  const engine = await fetchTeamServerMe(origin)
  if (engine?.state === 'stopped') await startTeamServerEngine(origin)
}

// ---------------------------------------------------------------------------
// Messages

export function serverUrlErrorMessage(error: ServerUrlError, lang: Language): string {
  switch (error) {
    case 'empty': return t('teamServerUrlRequired', lang)
    case 'insecure': return t('teamServerUrlInsecure', lang)
    case 'path': return t('teamServerUrlPath', lang)
    default: return t('teamServerUrlInvalid', lang)
  }
}

export function teamServerFailureMessage(error: TeamServerFailure, lang: Language, origin: string): string {
  const host = serverHost(origin)
  switch (error.code) {
    case 'invalid_url': return t('teamServerUrlInvalid', lang)
    case 'not_mira_server': return t('teamServerErrorNotMiraServer', lang, { url: origin })
    case 'protocol_unsupported': return t('teamServerErrorProtocol', lang, { protocol: error.message || '?' })
    case 'invalid_credentials': return t('teamServerErrorInvalidCredentials', lang)
    case 'forbidden': return t('teamServerErrorForbidden', lang)
    case 'too_many_attempts': return error.retryAfter
      ? t('teamServerErrorTooManyWait', lang, { seconds: Math.ceil(error.retryAfter) })
      : t('teamServerErrorTooMany', lang)
    case 'signed_out': return t('teamServerSessionExpired', lang, { host })
    case 'network': return t('teamServerErrorNetwork', lang, { host })
    case 'timeout': return t('teamServerErrorTimeout', lang, { host })
    case 'tls': return t('teamServerErrorTls', lang, { host, detail: error.message ? ` (${error.message})` : '' })
    case 'invalid_response': return t('teamServerErrorInvalidResponse', lang)
    case 'unavailable': return t('teamServerDesktopRequired', lang)
    default: return error.message
      ? t('teamServerErrorServerDetail', lang, { status: error.status ?? '?', detail: error.message })
      : t('teamServerErrorServer', lang, { status: error.status ?? '?' })
  }
}

export function teamServerEngineIssueMessage(code: 'engine_unavailable' | 'engine_conflict', lang: Language, origin: string, detail?: string | null): string {
  const host = serverHost(origin)
  if (code === 'engine_conflict') return t('teamServerEngineConflict', lang, { host })
  return detail
    ? t('teamServerEngineUnavailableDetail', lang, { host, detail })
    : t('teamServerEngineUnavailable', lang, { host })
}

export function resetTeamServerAuthForTests(): void {
  forgetTeamServerAccess()
}

// Sign out (user menu or Settings): revoke on the server, forget locally and
// stop talking to the engine until the user signs in again.
export async function signOutTeamServer(origin: string): Promise<void> {
  await logoutTeamServer(origin)
  const settings = useSettingsStore.getState()
  if (activeTeamServerOrigin() !== origin) return
  const message = t('teamServerSignedOut', settings.language, { host: serverHost(origin) })
  settings.setEngineBootstrap({ status: 'unreachable', message, version: null })
  settings.setConnectionMessage(message)
}
