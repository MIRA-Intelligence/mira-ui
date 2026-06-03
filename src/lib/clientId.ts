const STORAGE_KEY = 'medpilot-client-id'

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for older runtimes (and tests without crypto.randomUUID)
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

let cached: string | null = null

export function getClientId(): string {
  if (cached) return cached
  const ls = safeLocalStorage()
  if (ls) {
    const existing = ls.getItem(STORAGE_KEY)
    if (existing && existing.length > 0) {
      cached = existing
      return existing
    }
  }
  const fresh = `anon_${generateUuid()}`
  cached = fresh
  if (ls) {
    try { ls.setItem(STORAGE_KEY, fresh) } catch { /* ignore */ }
  }
  return fresh
}

// Compact, human-readable handle derived from the client id. Stable across
// sessions for the same install. Used in Feishu cards and the feedback form
// so users can reference themselves without leaking the raw UUID.
export function getDisplayHandle(): string {
  const id = getClientId()
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase() || 'xxxx'
  return `anon_${tail}`
}

// Test helper — not used at runtime.
export function __resetClientIdCache(): void {
  cached = null
}
