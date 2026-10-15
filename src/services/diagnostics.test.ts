import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportDiagnostics, installRuntimeDiagnostics, recentDiagnostics } from './diagnostics'

describe('renderer runtime diagnostics', () => {
  let dispose: (() => void) | undefined
  afterEach(() => { dispose?.(); dispose=undefined; delete window.electronAPI; vi.unstubAllGlobals() })

  it('keeps HTTP behavior while correlating only engine requests and excluding payloads', async () => {
    const nativeFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/version') ? Response.json({ diagnostics_contract: 1 })
        : new Response('private-patient-response',{ status: 503 }))
    vi.stubGlobal('fetch',nativeFetch)
    dispose = installRuntimeDiagnostics(()=> 'http://127.0.0.1:18790/api')
    await fetch('http://127.0.0.1:18790/api/version')
    const result = await fetch('http://127.0.0.1:18790/api/sessions/private-patient/history?token=secret')
    expect(result.status).toBe(503)
    const args = nativeFetch.mock.calls[1] as unknown as [string,RequestInit]
    expect(new Headers(args[1].headers).get('X-Mira-Request-Id')).toBeTruthy()
    const record = recentDiagnostics().at(-1)
    expect(record?.event).toBe('http.response_error')
    expect(record?.fields.route).toBe('/api/sessions/:id/history')
    expect(JSON.stringify(record)).not.toContain('private-patient')
    await fetch('https://other.example/api/test')
    expect(nativeFetch.mock.calls.at(-1)?.length).toBe(2)
    expect((nativeFetch.mock.calls.at(-1) as unknown as [string,RequestInit])[1]).toBeUndefined()
  })

  it('negotiates tracing through the gateway-root version probe used by the app', async () => {
    const nativeFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/version') ? Response.json({ agent_version: '9.9.9', diagnostics_contract: 1 })
        : String(input).endsWith('/health') ? Response.json({ status: 'ok' })
          : Response.json({ ok: true }))
    vi.stubGlobal('fetch',nativeFetch)
    dispose = installRuntimeDiagnostics(()=> 'http://127.0.0.1:18790/api')
    const { probeEngineCompatibility } = await import('./engine')
    await probeEngineCompatibility('http://127.0.0.1:18790/api')
    expect(nativeFetch.mock.calls.map((call)=>String(call[0]))).toEqual([
      'http://127.0.0.1:18790/health', 'http://127.0.0.1:18790/version'])
    await fetch('http://127.0.0.1:18790/api/sessions')
    const args = nativeFetch.mock.calls.at(-1) as unknown as [string,RequestInit]
    expect(new Headers(args[1].headers).get('X-Mira-Request-Id')).toBeTruthy()
  })

  it('does not add headers that would break CORS on older remote engines', async () => {
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ agent_version: 'older' }))
    vi.stubGlobal('fetch',nativeFetch)
    dispose = installRuntimeDiagnostics(()=> 'https://old.example/api')
    await fetch('https://old.example/api/version')
    await fetch('https://old.example/api/status')
    expect(nativeFetch.mock.calls.every((call)=>call[1] === undefined)).toBe(true)
  })

  it('records global exceptions through the desktop bridge and passes export cancellation through', async () => {
    const report = vi.fn()
    window.electronAPI = { platform: 'darwin', recordDiagnostic: report,exportDiagnostics: vi.fn(async()=>null) }
    dispose = installRuntimeDiagnostics(()=> 'http://127.0.0.1:18790/api')
    window.dispatchEvent(new ErrorEvent('error',{ error: new TypeError('private patient body') }))
    expect(report.mock.calls.at(-1)?.[0].event).toBe('renderer.uncaught_error')
    expect(JSON.stringify(report.mock.calls)).not.toContain('private patient body')
    expect(await exportDiagnostics(false)).toBeNull()
    expect(window.electronAPI.exportDiagnostics).toHaveBeenCalledWith({ includeLocalEngine: false })
  })
})
