import { engineTokenOrigin, useSettingsStore } from '@/stores/settingsStore'
import {
  activeTeamServerOrigin,
  checkTeamServerAfterDisconnect,
  ensureTeamServerSession,
  refreshTeamServerAccess,
  teamServerAccessToken,
} from './teamServer'
import { useTeamServerStore } from '@/stores/teamServerStore'

// The engine gateway requires a per-install token on /api/* and /ws (see
// MIRA-Intelligence/mira#149). Headers carry it on fetch; URLs that cannot set
// headers (WebSocket, img/iframe src, downloads) carry it as access_token.
export const ACCESS_TOKEN_PARAM = 'access_token'
const LOCAL_ENGINE_ORIGIN = 'http://127.0.0.1:18790'
const UNAUTHENTICATED_PATHS = new Set(['/health', '/version', '/api/health', '/api/version'])

let desktopToken: string | null = null
let desktopTokenRead: Promise<string | null> | null = null
// Remote-SSH: the main process holds the token for the forwarded engine.
let sshToken: string | null = null
let sshTokenRead: Promise<string | null> | null = null
let installed = false

// Engine tokens are keyed by gateway origin: the API and WebSocket endpoints of
// one engine share it. ws(s) URLs map to their http(s) origin.
export function engineOrigin(value: string): string | null {
  try {
    return engineTokenOrigin(new URL(value, window.location.href).href)
  } catch { return null }
}

function hasDesktopTokenBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.getEngineToken === 'function'
}

export async function refreshDesktopEngineToken(): Promise<string | null> {
  if (!hasDesktopTokenBridge()) return null
  desktopTokenRead ??= window.electronAPI!.getEngineToken!()
    .then((token) => (typeof token === 'string' && token ? token : null))
    .catch(() => null)
    .then((token) => {
      desktopToken = token
      desktopTokenRead = null
      return token
    })
  return desktopTokenRead
}

function usesRemoteSshToken(origin: string): boolean {
  const settings = useSettingsStore.getState()
  return settings.deploymentMode === 'remoteSsh'
    && typeof window !== 'undefined'
    && typeof window.electronAPI?.getRemoteSshToken === 'function'
    && origin === engineOrigin(settings.apiUrl)
}

export async function refreshRemoteSshToken(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof window.electronAPI?.getRemoteSshToken !== 'function') return null
  sshTokenRead ??= window.electronAPI.getRemoteSshToken()
    .then((token) => (typeof token === 'string' && token ? token : null))
    .catch(() => null)
    .then((token) => {
      sshToken = token
      sshTokenRead = null
      return token
    })
  return sshTokenRead
}

// Called when the Remote-SSH connection changes; the next request re-reads.
export function forgetRemoteSshToken(): void {
  sshToken = null
}

// Team server: every request to the Mira Server origin (/api, /server, /ws)
// carries the user's access token, which the main process refreshes.
function usesTeamServerToken(origin: string): boolean {
  return origin === activeTeamServerOrigin()
}

// Re-read every token the desktop app manages (local engine file, Remote-SSH,
// Team server session).
export function refreshManagedEngineTokens(): Promise<unknown> {
  const settings = useSettingsStore.getState()
  if (settings.deploymentMode === 'teamServer') return checkTeamServerAfterDisconnect()
  return settings.deploymentMode === 'remoteSsh' ? refreshRemoteSshToken() : refreshDesktopEngineToken()
}

function usesDesktopToken(origin: string): boolean {
  if (origin !== LOCAL_ENGINE_ORIGIN || !hasDesktopTokenBridge()) return false
  if (usesRemoteSshToken(origin) || usesTeamServerToken(origin)) return false
  const settings = useSettingsStore.getState()
  // A remote profile pointing at the local engine may carry its own token;
  // otherwise the desktop app can read the local engine's token file.
  return settings.deploymentMode === 'localBundle' || !settings.engineTokens[origin]
}

// True when requests to this URL authenticate with the local engine's token file.
export function usesDesktopEngineToken(value: string): boolean {
  const origin = engineOrigin(value)
  return origin !== null && usesDesktopToken(origin)
}

export function engineTokenFor(value: string): string | null {
  const origin = engineOrigin(value)
  if (!origin) return null
  if (usesTeamServerToken(origin)) return teamServerAccessToken(origin)
  if (usesRemoteSshToken(origin)) return sshToken
  if (usesDesktopToken(origin)) return desktopToken
  return useSettingsStore.getState().engineTokens[origin] || null
}

async function resolveEngineToken(value: string): Promise<string | null> {
  const origin = engineOrigin(value)
  if (!origin) return null
  if (usesTeamServerToken(origin)) {
    const current = teamServerAccessToken(origin)
    if (current) return current
    const session = await ensureTeamServerSession(origin)
    return session.ok ? session.session.accessToken : null
  }
  if (usesRemoteSshToken(origin)) return sshToken ?? refreshRemoteSshToken()
  if (usesDesktopToken(origin)) return desktopToken ?? refreshDesktopEngineToken()
  return useSettingsStore.getState().engineTokens[origin] || null
}

function isKnownEngineOrigin(origin: string): boolean {
  const settings = useSettingsStore.getState()
  if (origin === engineOrigin(settings.apiUrl) || origin === engineOrigin(settings.wsUrl)) return true
  if (origin === LOCAL_ENGINE_ORIGIN && hasDesktopTokenBridge()) return true
  return Boolean(settings.engineTokens[origin])
}

// Adds access_token to engine URLs that cannot carry an Authorization header.
// Non-engine URLs are returned untouched so tokens never leak to third parties.
export function withEngineAuth(value: string): string {
  const origin = engineOrigin(value)
  if (!origin || !value || !isKnownEngineOrigin(origin)) return value
  const token = engineTokenFor(value)
  if (!token) return value
  try {
    const url = new URL(value, window.location.href)
    url.searchParams.set(ACCESS_TOKEN_PARAM, token)
    return url.toString()
  } catch { return value }
}

// Never show or record a URL with its token attached.
export function redactEngineAuth(value: string): string {
  try {
    const url = new URL(value)
    if (!url.searchParams.has(ACCESS_TOKEN_PARAM)) return value
    url.searchParams.delete(ACCESS_TOKEN_PARAM)
    return url.toString()
  } catch { return value }
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
  } catch { return null }
}

function canReplay(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (input instanceof Request) return !input.bodyUsed
  return !(typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream)
}

function authorized(input: RequestInfo | URL, init: RequestInit | undefined, token: string): [RequestInfo | URL, RequestInit] {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return [input instanceof Request ? input.clone() : input, { ...init, headers }]
}

export type EngineUnauthorizedHandler = (origin: string, desktop: boolean) => void

// Mira Server answers /api/* with 503 engine_starting (Retry-After: 2) while
// it starts the user's engine; the request never reached the engine, so it is
// sent again until the engine is up instead of failing as "unreachable".
const ENGINE_START_TIMEOUT_MS = 180_000
const ENGINE_START_MAX_DELAY_MS = 10_000
const ENGINE_START_DEFAULT_DELAY_S = 2

async function serverErrorCode(response: Response): Promise<{ code: string; message: string | null }> {
  try {
    const body = await response.clone().json() as { error?: unknown; message?: unknown }
    return {
      code: typeof body.error === 'string' ? body.error : '',
      message: typeof body.message === 'string' ? body.message : null,
    }
  } catch {
    return { code: '', message: null }
  }
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('Retry-After'))
  // Retry-After needs Access-Control-Expose-Headers to be readable cross-origin.
  const seconds = Number.isFinite(header) && header > 0 ? header : ENGINE_START_DEFAULT_DELAY_S
  const backoff = seconds * 1000 * Math.pow(1.5, Math.min(attempt, 6))
  return Math.min(ENGINE_START_MAX_DELAY_MS, Math.max(seconds * 1000, backoff))
}

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function sendWhileEngineStarts(send: () => Promise<Response>, replayable: boolean): Promise<Response> {
  const store = useTeamServerStore.getState()
  const deadline = Date.now() + ENGINE_START_TIMEOUT_MS
  let waiting = false
  try {
    for (let attempt = 0; ; attempt += 1) {
      const response = await send()
      if (response.status !== 503 && response.status !== 409) {
        if (response.ok) store.setEngineIssue(null)
        return response
      }
      const { code, message } = await serverErrorCode(response)
      if (code === 'engine_unavailable' || code === 'engine_conflict') {
        store.setEngineIssue({ code, message })
        return response
      }
      if (code !== 'engine_starting' || !replayable || Date.now() >= deadline) return response
      if (!waiting) {
        waiting = true
        store.beginStarting()
      }
      await sleep(retryAfterMs(response, attempt))
    }
  } finally {
    if (waiting) store.endStarting()
  }
}

// Wraps window.fetch so every request to a known engine origin carries the
// gateway token. A desktop 401 re-reads the token file once (it is rotated when
// the engine is reinstalled) before reporting the failure.
export function installEngineAuth(onUnauthorized: EngineUnauthorizedHandler): () => void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {}
  installed = true
  const originalFetch = window.fetch
  const wrappedFetch: typeof fetch = async (input, init) => {
    const url = requestUrl(input)
    if (!url || !isKnownEngineOrigin(url.origin) || init?.method === 'OPTIONS') {
      return originalFetch.call(window, input, init)
    }
    const token = await resolveEngineToken(url.href)
    if (!token) {
      const response = await originalFetch.call(window, input, init)
      if (response.status === 401 && !UNAUTHENTICATED_PATHS.has(url.pathname)) {
        onUnauthorized(url.origin, usesDesktopToken(url.origin))
      }
      return response
    }
    const replayable = canReplay(input, init)
    if (usesTeamServerToken(url.origin)) {
      const send = (current: string) => sendWhileEngineStarts(
        () => originalFetch.call(window, ...authorized(input, init, current)), replayable,
      )
      let response = await send(token)
      if (response.status !== 401) return response
      // Expired or revoked access token: refresh once (shared by every request
      // that failed meanwhile) and retry. If that fails, sign-in is shown.
      let rejected = true
      if (replayable) {
        const fresh = await refreshTeamServerAccess(url.origin, token)
        if (fresh && fresh !== token) {
          response = await send(fresh)
          if (response.status !== 401) return response
        } else if (useTeamServerStore.getState().phase === 'signedIn') {
          // Refresh failed for a transient reason (offline): the session
          // itself was not rejected, so do not report it as signed out.
          rejected = false
        }
      }
      if (rejected) onUnauthorized(url.origin, true)
      return response
    }
    let response = await originalFetch.call(window, ...authorized(input, init, token))
    if (response.status !== 401) return response
    const desktop = usesDesktopToken(url.origin)
    const remoteSsh = usesRemoteSshToken(url.origin)
    if ((desktop || remoteSsh) && replayable) {
      // The engine may have restarted with a new token (rotation, or a
      // Remote-SSH re-attach); re-read once before reporting the failure.
      const fresh = await (remoteSsh ? refreshRemoteSshToken() : refreshDesktopEngineToken())
      if (fresh && fresh !== token) {
        response = await originalFetch.call(window, ...authorized(input, init, fresh))
        if (response.status !== 401) return response
      }
    }
    onUnauthorized(url.origin, desktop || remoteSsh)
    return response
  }
  window.fetch = wrappedFetch
  return () => {
    if (window.fetch === wrappedFetch) window.fetch = originalFetch
    installed = false
  }
}

export function setEngineStartSleepForTests(fn: (ms: number) => Promise<void>): void {
  sleep = fn
}

export function resetEngineAuthForTests(): void {
  desktopToken = null
  desktopTokenRead = null
  sshToken = null
  sshTokenRead = null
}
