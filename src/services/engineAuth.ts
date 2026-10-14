import { engineTokenOrigin, useSettingsStore } from '@/stores/settingsStore'

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

// Re-read every token the desktop app manages (local engine file, Remote-SSH).
export function refreshManagedEngineTokens(): Promise<unknown> {
  const settings = useSettingsStore.getState()
  return settings.deploymentMode === 'remoteSsh' ? refreshRemoteSshToken() : refreshDesktopEngineToken()
}

function usesDesktopToken(origin: string): boolean {
  if (origin !== LOCAL_ENGINE_ORIGIN || !hasDesktopTokenBridge()) return false
  if (usesRemoteSshToken(origin)) return false
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
  if (usesRemoteSshToken(origin)) return sshToken
  if (usesDesktopToken(origin)) return desktopToken
  return useSettingsStore.getState().engineTokens[origin] || null
}

async function resolveEngineToken(value: string): Promise<string | null> {
  const origin = engineOrigin(value)
  if (!origin) return null
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

export function resetEngineAuthForTests(): void {
  desktopToken = null
  desktopTokenRead = null
  sshToken = null
  sshTokenRead = null
}
