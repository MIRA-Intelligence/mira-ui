import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { createMockMiraServer, type MockMiraServer } from '@/test/mockMiraServer'
import { installTeamServerBridge } from '@/test/teamServerBridge'
import { installEngineAuth, resetEngineAuthForTests, setEngineStartSleepForTests, withEngineAuth } from './engineAuth'
import {
  checkTeamServerAfterDisconnect,
  ensureTeamServerSession,
  loginTeamServer,
  onTeamServerSession,
  resetTeamServerAuthForTests,
  teamServerAccessToken,
  teamServerFailureMessage,
} from './teamServer'
import { probeEngineCompatibility } from './engine'
import { failure } from '@/lib/teamServerProtocol'

const ORIGIN = 'https://mira.example.com'

describe('Team server traffic', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()
  let server: MockMiraServer
  let disposers: Array<() => void> = []
  let onUnauthorized: ReturnType<typeof vi.fn<(origin: string, desktop: boolean) => void>>
  let sleeps: number[]

  beforeEach(() => {
    resetEngineAuthForTests()
    resetTeamServerAuthForTests()
    useTeamServerStore.setState(initialTeam, true)
    useSettingsStore.setState(initialSettings, true)
    useSettingsStore.getState().setTeamServer(ORIGIN)
    server = createMockMiraServer()
    installTeamServerBridge(server)
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => server.fetch(input, init)))
    onUnauthorized = vi.fn<(origin: string, desktop: boolean) => void>()
    disposers.push(installEngineAuth(onUnauthorized))
    sleeps = []
    setEngineStartSleepForTests(async (ms) => { sleeps.push(ms) })
  })

  afterEach(() => {
    disposers.reverse().forEach((dispose) => dispose())
    disposers = []
    delete window.electronAPI
    vi.unstubAllGlobals()
  })

  async function signIn() {
    const result = await loginTeamServer(ORIGIN, 'alice', 'correct horse')
    expect(result.ok).toBe(true)
    return result.ok ? result.session.accessToken : ''
  }

  it('sends the access token to /api and /server on the server origin only', async () => {
    const token = await signIn()
    await fetch(`${ORIGIN}/api/projects`)
    await fetch(`${ORIGIN}/server/me`)
    expect(server.requests.slice(-2).map((r) => [r.path, r.authorization])).toEqual([
      ['/api/projects', `Bearer ${token}`],
      ['/server/me', `Bearer ${token}`],
    ])
    await fetch('https://other.example.com/api/projects')
    expect(server.requests.at(-1)).toMatchObject({ authorization: null })
  })

  it('puts the access token on WebSocket and resource URLs (they cannot set headers)', async () => {
    const token = await signIn()
    const settings = useSettingsStore.getState()
    expect(settings.wsUrl).toBe('wss://mira.example.com/ws')
    const ws = new URL(withEngineAuth(settings.wsUrl))
    expect(ws.searchParams.get('access_token')).toBe(token)
    const artifact = new URL(withEngineAuth(`${settings.apiUrl}/projects/p/artifacts?path=a.png`))
    expect(artifact.searchParams.get('access_token')).toBe(token)
    expect(withEngineAuth('https://example.org/a.png')).toBe('https://example.org/a.png')
  })

  it('refreshes once on 401 and retries every failed request', async () => {
    const before = await signIn()
    server.expireAccessTokens()
    const responses = await Promise.all([
      fetch(`${ORIGIN}/api/projects`),
      fetch(`${ORIGIN}/api/config`),
      fetch(`${ORIGIN}/server/me`),
    ])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect(server.count('POST', '/server/auth/refresh')).toBe(1)
    const after = teamServerAccessToken(ORIGIN)
    expect(after).not.toBe(before)
    expect(server.requests.at(-1)?.authorization).toBe(`Bearer ${after}`)
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(useTeamServerStore.getState().login).toBeNull()
  })

  it('signs out and asks to sign in again when the refresh fails', async () => {
    await signIn()
    server.expireAccessTokens()
    for (const entry of server.refresh.values()) server.revokedFamilies.add(entry.family)
    const response = await fetch(`${ORIGIN}/api/projects`)
    expect(response.status).toBe(401)
    expect(onUnauthorized).toHaveBeenCalledWith(ORIGIN, true)
    expect(useTeamServerStore.getState()).toMatchObject({ phase: 'signedOut', login: { origin: ORIGIN, reason: 'expired' } })
    expect(teamServerAccessToken(ORIGIN)).toBeNull()
  })

  it('stays signed out at launch without a stored session, and does not prompt', async () => {
    expect(await ensureTeamServerSession(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
    expect(useTeamServerStore.getState()).toMatchObject({ phase: 'signedOut', login: null })
    expect(server.requests).toHaveLength(0)
  })

  it('adopts a proactively refreshed token without a reconnect', async () => {
    const { manager } = installTeamServerBridge(server)
    // useWebSocket subscribes to these pushes while in Team server mode.
    disposers.push(onTeamServerSession(() => {}))
    const first = await signIn()
    const refreshed = await manager.refresh(ORIGIN)
    expect(refreshed.ok).toBe(true)
    await vi.waitFor(() => expect(teamServerAccessToken(ORIGIN)).not.toBe(first))
    expect(new URL(withEngineAuth(useSettingsStore.getState().wsUrl)).searchParams.get('access_token')).toBe(teamServerAccessToken(ORIGIN))
  })

  it('waits while Mira Server starts the engine (503 engine_starting)', async () => {
    await signIn()
    server.state.startingPolls = 3
    const seen: number[] = []
    const unsubscribe = useTeamServerStore.subscribe((state) => seen.push(state.startingRequests))
    const response = await fetch(`${ORIGIN}/api/projects`, { method: 'POST', body: '{"name":"x"}' })
    unsubscribe()
    expect(response.status).toBe(200)
    expect(server.count('POST', '/api/projects')).toBe(4)
    // Retry-After: 2, backing off up to 10 s.
    expect(sleeps).toEqual([2000, 3000, 4500])
    expect(seen).toContain(1)
    expect(useTeamServerStore.getState().startingRequests).toBe(0)
  })

  it('does not replay a streamed body', async () => {
    await signIn()
    server.state.startingPolls = 1
    const body = new ReadableStream({ start(controller) { controller.close() } })
    const response = await fetch(`${ORIGIN}/api/upload`, { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect(response.status).toBe(503)
    expect(sleeps).toEqual([])
  })

  it('reports engine_conflict and engine_unavailable', async () => {
    await signIn()
    server.state.engineState = 'conflict'
    expect((await fetch(`${ORIGIN}/api/projects`)).status).toBe(409)
    expect(useTeamServerStore.getState().engineIssue).toMatchObject({ code: 'engine_conflict' })
    server.state.engineState = 'error'
    server.state.engineMessage = 'launcher failed'
    expect((await fetch(`${ORIGIN}/api/projects`)).status).toBe(503)
    expect(useTeamServerStore.getState().engineIssue).toEqual({ code: 'engine_unavailable', message: 'launcher failed' })
    server.state.engineState = 'running'
    expect((await fetch(`${ORIGIN}/api/projects`)).status).toBe(200)
    expect(useTeamServerStore.getState().engineIssue).toBeNull()
  })

  it('probes the engine through /api on Mira Server', async () => {
    await signIn()
    const probe = await probeEngineCompatibility(`${ORIGIN}/api`)
    expect(server.requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/api/version', '/api/config']))
    expect(server.requests.some((r) => r.path === '/health' || r.path === '/version')).toBe(false)
    expect(probe.version).toBe('0.5.0')
  })

  it('explains a conflicting engine in the probe', async () => {
    await signIn()
    server.state.engineState = 'conflict'
    const probe = await probeEngineCompatibility(`${ORIGIN}/api`)
    expect(probe).toMatchObject({ status: 'unreachable', message: expect.stringContaining('mira gateway') })
  })

  it('starts an engine that was stopped while the socket was down', async () => {
    await signIn()
    server.state.engineState = 'stopped'
    await checkTeamServerAfterDisconnect()
    expect(server.count('POST', '/server/engine/start')).toBe(1)
    expect(useTeamServerStore.getState().engine).toMatchObject({ state: 'starting' })
  })

  it('never writes tokens to localStorage', async () => {
    const entries = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
      removeItem: (key: string) => { entries.delete(key) },
    })
    const token = await signIn()
    useSettingsStore.getState().setServerUsername('alice')
    const persisted = localStorage.getItem('mira-ui-settings') ?? ''
    expect(persisted).toContain('"serverUrl":"https://mira.example.com"')
    expect(persisted).not.toContain(token)
    expect(persisted).not.toMatch(/rt-alice|at-alice|correct horse/)
  })
})

describe('teamServerFailureMessage', () => {
  it('explains each failure', () => {
    expect(teamServerFailureMessage(failure('invalid_credentials', '', 401), 'en', ORIGIN)).toBe('Wrong user name or password.')
    expect(teamServerFailureMessage(failure('forbidden', '', 403), 'en', ORIGIN)).toContain('mira-users')
    expect(teamServerFailureMessage(failure('too_many_attempts', '', 429, 30), 'en', ORIGIN)).toContain('30 s')
    expect(teamServerFailureMessage(failure('tls', 'net::ERR_CERT_DATE_INVALID'), 'en', ORIGIN)).toContain('ERR_CERT_DATE_INVALID')
    expect(teamServerFailureMessage(failure('network'), 'zh', ORIGIN)).toContain('mira.example.com')
    expect(teamServerFailureMessage(failure('not_mira_server'), 'en', ORIGIN)).toContain('not a Mira Server')
  })
})
