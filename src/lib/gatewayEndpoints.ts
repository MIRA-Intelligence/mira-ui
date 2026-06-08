import type { DeploymentMode } from '@/stores/settingsStore'

const LOCAL_API_BASE = 'http://127.0.0.1:18790/api'
const LOCAL_WS_URL = 'ws://127.0.0.1:18790/ws'

function isBrowserDev(): boolean {
  return import.meta.env.DEV
    && typeof window !== 'undefined'
    && !window.electronAPI
}

/** API base for HTTP calls. Vite dev uses same-origin proxy to avoid CORS / bad host. */
export function resolveApiUrl(
  state: { apiUrl: string; deploymentMode: DeploymentMode },
): string {
  if (isBrowserDev()) {
    return `${window.location.origin}/api`
  }
  if (state.deploymentMode === 'localBundle') return LOCAL_API_BASE
  const raw = (state.apiUrl || LOCAL_API_BASE).trim()
  try {
    const u = new URL(raw)
    if (u.hostname === '0.0.0.0' || u.hostname === '') {
      u.hostname = '127.0.0.1'
    }
    u.pathname = u.pathname.replace(/\/$/, '') || '/api'
    return u.toString().replace(/\/$/, '')
  } catch {
    return LOCAL_API_BASE
  }
}

/** WebSocket URL aligned with resolveApiUrl(). */
export function resolveWsUrl(
  state: { wsUrl: string; deploymentMode: DeploymentMode },
): string {
  if (isBrowserDev()) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  if (state.deploymentMode === 'localBundle') return LOCAL_WS_URL
  const raw = (state.wsUrl || LOCAL_WS_URL).trim()
  try {
    const u = new URL(raw)
    if (u.hostname === '0.0.0.0' || u.hostname === '') {
      u.hostname = '127.0.0.1'
    }
    return u.toString()
  } catch {
    return LOCAL_WS_URL
  }
}
