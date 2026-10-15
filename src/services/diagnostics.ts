import { createUuid } from '@/lib/uuid'
import { diagnosticRoute, safeDiagnosticError, sanitizeDiagnosticEvent,
  type DiagnosticEvent, type DiagnosticLevel } from '@/lib/diagnosticPrivacy'

const ring: DiagnosticEvent[] = []
const MAX_EVENTS = 300
let installed = false

export function recordDiagnostic(event: string, fields: DiagnosticEvent['fields'] = {},
  error?: unknown, level: DiagnosticLevel = error ? 'ERROR' : 'INFO'): void {
  const record = sanitizeDiagnosticEvent({ event, level, fields,
    ...(error !== undefined ? { error: safeDiagnosticError(error) } : {}) })
  if (!record) return
  ring.push(record)
  if (ring.length > MAX_EVENTS) ring.shift()
  // A missing or failed diagnostic bridge must never break application work.
  try { window.electronAPI?.recordDiagnostic?.(record) } catch { /* best effort */ }
}

export function recentDiagnostics(): DiagnosticEvent[] {
  return ring.map((event) => ({ ...event, fields: { ...event.fields },
    ...(event.error ? { error: { ...event.error, frames: [...event.error.frames] } } : {}) }))
}

export function installRuntimeDiagnostics(getEngineApi: () => string): () => void {
  if (installed) return () => {}
  installed = true
  const onError = (event: ErrorEvent) => recordDiagnostic('renderer.uncaught_error', {},
    event.error ?? new Error('UncaughtError'), 'ERROR')
  const onRejection = (event: PromiseRejectionEvent) => recordDiagnostic('renderer.unhandled_rejection', {}, event.reason, 'ERROR')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const originalFetch = window.fetch
  const traceOrigins = new Set<string>()
  const wrappedFetch: typeof fetch = async (input, init) => {
    let url: URL
    let isProbe = false
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
      const engine = new URL(getEngineApi(), window.location.href)
      const apiPath = engine.pathname.replace(/\/$/, '')
      // The compatibility probe calls /health and /version on the gateway root
      // (the API URL without /api), so those must negotiate tracing too.
      const gatewayPath = apiPath.replace(/\/api$/, '')
      isProbe = url.pathname === `${gatewayPath}/version` || url.pathname === `${gatewayPath}/health`
      if (url.origin !== engine.origin || (!isProbe && !url.pathname.startsWith(apiPath + '/'))) {
        return originalFetch.call(window, input, init)
      }
    } catch { return originalFetch.call(window, input, init) }
    const requestId = createUuid()
    const traceSupported = traceOrigins.has(url.origin) && !isProbe
    let options = init
    // Older remote engines do not allow this header in CORS preflight. Negotiate
    // against /version before adding it, and never add it to the probes that
    // decide whether an engine is reachable; diagnostics must preserve connectivity.
    if (traceSupported) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('X-Mira-Request-Id', requestId)
      options = { ...init, headers }
    }
    const started = performance.now()
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const fields = { request_id: requestId, method, route: diagnosticRoute(url.href), trace_supported: traceSupported }
    try {
      const response = await originalFetch.call(window, input, options)
      if (url.pathname.endsWith('/version')) {
        try {
          const version = await response.clone().json() as { diagnostics_contract?: number }
          if (response.ok && version.diagnostics_contract === 1) traceOrigins.add(url.origin)
          else traceOrigins.delete(url.origin)
        } catch { traceOrigins.delete(url.origin) }
      }
      if (response.status >= 400) recordDiagnostic('http.response_error',
        { ...fields, status: response.status, duration_ms: Math.round(performance.now() - started) }, undefined,
        response.status >= 500 ? 'ERROR' : 'WARNING')
      return response
    } catch (error) {
      recordDiagnostic('http.network_error', { ...fields, duration_ms: Math.round(performance.now() - started) }, error)
      throw error
    }
  }
  if (typeof originalFetch === 'function') window.fetch = wrappedFetch
  recordDiagnostic('renderer.started')
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    if (window.fetch === wrappedFetch) window.fetch = originalFetch
    installed = false
  }
}

export async function exportDiagnostics(includeLocalEngine: boolean): Promise<string | null> {
  if (window.electronAPI?.exportDiagnostics) {
    return window.electronAPI.exportDiagnostics({ includeLocalEngine })
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ schema_version: 1, component: 'browser',
    app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
    created_at: new Date().toISOString(), scope: 'Current browser tab only; engine logs must be exported on the server.',
    privacy: 'Metadata and stack locations only; no conversation, configuration or native dumps.' }, null, 2))
  zip.file('renderer.jsonl', recentDiagnostics().map((row) => JSON.stringify(row)).join('\n') + '\n')
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `mira-diagnostics-${Date.now()}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return link.download
}
