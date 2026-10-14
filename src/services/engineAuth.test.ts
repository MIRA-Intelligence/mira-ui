import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/stores/settingsStore'
import { installRuntimeDiagnostics, recentDiagnostics } from './diagnostics'
import {
  forgetRemoteSshToken,
  installEngineAuth,
  redactEngineAuth,
  refreshDesktopEngineToken,
  resetEngineAuthForTests,
  withEngineAuth,
} from './engineAuth'
import { getProjectArtifactUrl } from './api'

const REMOTE_API = 'https://mira.lab.example:18790/api'
const REMOTE_WS = 'wss://mira.lab.example:18790/ws'
const REMOTE_TOKEN = 'remote-token-0123456789'
const LOCAL_TOKEN = 'local-token-0123456789ab'

function authHeader(call: unknown[] | undefined): string | null {
  const init = call?.[1] as RequestInit | undefined
  return new Headers(init?.headers).get('Authorization')
}

describe('engine gateway auth', () => {
  const initialState = useSettingsStore.getState()
  let disposers: Array<() => void> = []

  beforeEach(() => {
    resetEngineAuthForTests()
    useSettingsStore.setState({
      ...initialState,
      deploymentMode: 'remoteManual',
      apiUrl: REMOTE_API,
      wsUrl: REMOTE_WS,
      engineTokens: { 'https://mira.lab.example:18790': REMOTE_TOKEN },
      engineAuthRejected: false,
    })
  })

  afterEach(() => {
    disposers.reverse().forEach((dispose) => dispose())
    disposers = []
    delete window.electronAPI
    vi.unstubAllGlobals()
  })

  it('sends the bearer token only to the configured engine origin', async () => {
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', nativeFetch)
    disposers.push(installEngineAuth(vi.fn()))

    await fetch(`${REMOTE_API}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(authHeader(nativeFetch.mock.calls[0])).toBe(`Bearer ${REMOTE_TOKEN}`)
    expect(new Headers((nativeFetch.mock.calls[0][1] as RequestInit).headers).get('Content-Type')).toBe('application/json')

    await fetch('https://api.openai.example/v1/models')
    expect(nativeFetch.mock.calls[1][1]).toBeUndefined()
  })

  it('leaves requests untouched when no token is configured (older engines keep working)', async () => {
    useSettingsStore.setState({ engineTokens: {} })
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', nativeFetch)
    disposers.push(installEngineAuth(vi.fn()))

    await fetch(`${REMOTE_API}/status`)
    expect(nativeFetch.mock.calls[0][1]).toBeUndefined()
  })

  it('tokenizes engine WebSocket and resource URLs but never third-party URLs', () => {
    const ws = new URL(withEngineAuth(REMOTE_WS))
    expect(ws.searchParams.get('access_token')).toBe(REMOTE_TOKEN)
    expect(ws.pathname).toBe('/ws')

    const artifact = new URL(getProjectArtifactUrl('PRJ 1', 'out/figure.png'))
    expect(artifact.searchParams.get('access_token')).toBe(REMOTE_TOKEN)
    expect(artifact.searchParams.get('path')).toBe('out/figure.png')

    expect(withEngineAuth('https://example.org/paper.pdf')).toBe('https://example.org/paper.pdf')
    expect(redactEngineAuth(withEngineAuth(REMOTE_WS))).toBe(REMOTE_WS)
  })

  it('reports a remote 401 without retrying', async () => {
    const nativeFetch = vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 }))
    vi.stubGlobal('fetch', nativeFetch)
    const onUnauthorized = vi.fn()
    disposers.push(installEngineAuth(onUnauthorized))

    const response = await fetch(`${REMOTE_API}/config`)
    expect(response.status).toBe(401)
    expect(nativeFetch).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledWith('https://mira.lab.example:18790', false)
  })

  it('reads the desktop token over IPC and retries once after a rotated token', async () => {
    useSettingsStore.setState({
      deploymentMode: 'localBundle',
      apiUrl: 'http://127.0.0.1:18790/api',
      wsUrl: 'ws://127.0.0.1:18790/ws',
      engineTokens: {},
    })
    const getEngineToken = vi.fn()
      .mockResolvedValueOnce('stale-token-0123456789')
      .mockResolvedValueOnce(LOCAL_TOKEN)
    window.electronAPI = { platform: 'darwin', getEngineToken }
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      new Headers(init?.headers).get('Authorization') === `Bearer ${LOCAL_TOKEN}`
        ? Response.json({ ok: true })
        : Response.json({ error: 'unauthorized' }, { status: 401 })
    ))
    vi.stubGlobal('fetch', nativeFetch)
    const onUnauthorized = vi.fn()
    disposers.push(installEngineAuth(onUnauthorized))

    const response = await fetch('http://127.0.0.1:18790/api/projects', { method: 'POST', body: '{"name":"x"}' })
    expect(response.status).toBe(200)
    expect(nativeFetch.mock.calls.map(authHeader)).toEqual([
      'Bearer stale-token-0123456789', `Bearer ${LOCAL_TOKEN}`])
    expect((nativeFetch.mock.calls[1][1] as RequestInit).body).toBe('{"name":"x"}')
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(new URL(withEngineAuth('ws://127.0.0.1:18790/ws')).searchParams.get('access_token')).toBe(LOCAL_TOKEN)
  })

  it('reports a desktop 401 when the re-read token is rejected too', async () => {
    useSettingsStore.setState({ deploymentMode: 'localBundle', apiUrl: 'http://127.0.0.1:18790/api', engineTokens: {} })
    window.electronAPI = { platform: 'darwin', getEngineToken: vi.fn(async () => LOCAL_TOKEN) }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })))
    const onUnauthorized = vi.fn()
    disposers.push(installEngineAuth(onUnauthorized))

    await fetch('http://127.0.0.1:18790/api/config')
    expect(onUnauthorized).toHaveBeenCalledWith('http://127.0.0.1:18790', true)
  })

  it('uses the Remote-SSH token from the main process for the tunnel origin only', async () => {
    const SSH_TOKEN = 'ssh-token-0123456789abcd'
    useSettingsStore.setState({
      deploymentMode: 'remoteSsh',
      sshHost: 'lab',
      apiUrl: 'http://127.0.0.1:51000/api',
      wsUrl: 'ws://127.0.0.1:51000/ws',
      engineTokens: {},
    })
    const getRemoteSshToken = vi.fn(async () => SSH_TOKEN)
    const getEngineToken = vi.fn(async () => LOCAL_TOKEN)
    window.electronAPI = { platform: 'darwin', getRemoteSshToken, getEngineToken }
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', nativeFetch)
    disposers.push(installEngineAuth(vi.fn()))

    await fetch('http://127.0.0.1:51000/api/projects')
    expect(authHeader(nativeFetch.mock.calls[0])).toBe(`Bearer ${SSH_TOKEN}`)
    expect(new URL(withEngineAuth('ws://127.0.0.1:51000/ws')).searchParams.get('access_token')).toBe(SSH_TOKEN)
    expect(getEngineToken).not.toHaveBeenCalled()

    await fetch('https://api.openai.example/v1/models')
    expect(nativeFetch.mock.calls[1][1]).toBeUndefined()
    // Never persisted with the other settings.
    expect(JSON.stringify(useSettingsStore.getState().engineTokens)).not.toContain(SSH_TOKEN)
  })

  it('re-reads the Remote-SSH token once after a re-attach rotated it', async () => {
    const FRESH = 'ssh-token-fresh-0123456789'
    useSettingsStore.setState({ deploymentMode: 'remoteSsh', sshHost: 'lab', apiUrl: 'http://127.0.0.1:51000/api', engineTokens: {} })
    const getRemoteSshToken = vi.fn().mockResolvedValueOnce('ssh-token-stale-0123456789').mockResolvedValueOnce(FRESH)
    window.electronAPI = { platform: 'darwin', getRemoteSshToken }
    const nativeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      new Headers(init?.headers).get('Authorization') === `Bearer ${FRESH}`
        ? Response.json({ ok: true })
        : Response.json({ error: 'unauthorized' }, { status: 401 })
    ))
    vi.stubGlobal('fetch', nativeFetch)
    const onUnauthorized = vi.fn()
    disposers.push(installEngineAuth(onUnauthorized))

    const response = await fetch('http://127.0.0.1:51000/api/config')
    expect(response.status).toBe(200)
    expect(getRemoteSshToken).toHaveBeenCalledTimes(2)
    expect(onUnauthorized).not.toHaveBeenCalled()

    forgetRemoteSshToken()
    getRemoteSshToken.mockResolvedValueOnce(FRESH)
    await fetch('http://127.0.0.1:51000/api/config')
    expect(getRemoteSshToken).toHaveBeenCalledTimes(3)
  })

  it('treats a missing or failing desktop bridge as no token', async () => {
    window.electronAPI = { platform: 'darwin', getEngineToken: vi.fn(async () => { throw new Error('no window') }) }
    expect(await refreshDesktopEngineToken()).toBeNull()
    delete window.electronAPI
    expect(await refreshDesktopEngineToken()).toBeNull()
  })

  it('keeps the token out of renderer diagnostics', async () => {
    const nativeFetch = vi.fn(async () => new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', nativeFetch)
    disposers.push(installRuntimeDiagnostics(() => REMOTE_API))
    disposers.push(installEngineAuth(vi.fn()))

    await fetch(withEngineAuth(`${REMOTE_API}/projects/p1/artifacts?path=a.png`))
    const record = recentDiagnostics().at(-1)
    expect(record?.event).toBe('http.response_error')
    expect(JSON.stringify(recentDiagnostics())).not.toContain(REMOTE_TOKEN)
  })
})
