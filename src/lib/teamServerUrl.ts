// Mira Server ("Team server") addresses. Shared by the renderer and the
// Electron main process, which validates every origin it is asked to talk to.

export type ServerUrlError = 'empty' | 'invalid' | 'insecure' | 'path'

export type ParsedServerUrl =
  | { ok: true; origin: string; host: string; secure: boolean }
  | { ok: false; error: ServerUrlError }

// http:// is accepted only for a server on this computer (development).
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  return /^127(?:\.\d{1,3}){3}$/.test(host)
}

export function parseServerUrl(input: string): ParsedServerUrl {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: 'empty' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'invalid' }
  if (!url.hostname || url.username || url.password) return { ok: false, error: 'invalid' }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) return { ok: false, error: 'insecure' }
  // Mira Server serves /server, /api and /ws from the root of its origin.
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return { ok: false, error: 'path' }
  return { ok: true, origin: url.origin, host: url.host, secure: url.protocol === 'https:' }
}

// The canonical origin string, or null when it is not an acceptable server.
export function serverOrigin(input: string): string | null {
  const parsed = parseServerUrl(input)
  return parsed.ok ? parsed.origin : null
}

export function serverHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function teamServerEndpoints(origin: string): { apiUrl: string; wsUrl: string } {
  const url = new URL(origin)
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    apiUrl: `${url.origin}/api`,
    wsUrl: `${wsProtocol}//${url.host}/ws`,
  }
}
