import type { DeploymentMode } from '@/stores/settingsStore'

const LOCAL_API_BASE = 'http://127.0.0.1:18790/api'
const LOCAL_WS_URL = 'ws://127.0.0.1:18790/ws'

/** Preserve the configured gateway in browser dev as well as packaged builds.
 * To use Vite's proxy, configure the endpoints to the dev server's /api and /ws.
 * This also keeps token lookup aligned with the origin selected in settings.
 */
export function resolveApiUrl(
  state: { apiUrl: string; deploymentMode: DeploymentMode },
): string {
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
