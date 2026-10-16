import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const websocketMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}))

vi.mock('@/services/websocket', () => ({ wsClient: websocketMock }))

vi.mock('@/services/desktop', () => ({
  hasDesktopEngineManager: vi.fn(() => true),
  bootstrapLocalEngine: vi.fn(),
  getBootstrapState: vi.fn(),
  setEngineModeHint: vi.fn(),
}))

vi.mock('@/services/engine', () => ({ probeEngineCompatibility: vi.fn() }))

import { useWebSocket } from './useWebSocket'
import { probeEngineCompatibility } from '@/services/engine'
import { bootstrapLocalEngine } from '@/services/desktop'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { useAgentStore } from '@/stores/agentStore'
import { createMockMiraServer, type MockMiraServer } from '@/test/mockMiraServer'
import { installTeamServerBridge } from '@/test/teamServerBridge'
import { installEngineAuth, resetEngineAuthForTests } from '@/services/engineAuth'
import { loginTeamServer, resetTeamServerAuthForTests } from '@/services/teamServer'

const ORIGIN = 'https://mira.example.com'

function HookHarness() {
  useWebSocket()
  return null
}

describe('useWebSocket in Team server mode', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()
  let server: MockMiraServer
  let bridge: ReturnType<typeof installTeamServerBridge>
  let disposeAuth: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineAuthForTests()
    resetTeamServerAuthForTests()
    useSettingsStore.setState({ ...initialSettings, language: 'en', engineStatus: 'unknown', engineMessage: null, connectionMessage: null }, true)
    useSettingsStore.getState().setTeamServer(ORIGIN)
    useTeamServerStore.setState(initialTeam, true)
    useAgentStore.setState({ connected: false })
    server = createMockMiraServer()
    bridge = installTeamServerBridge(server)
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => server.fetch(input, init)))
    disposeAuth = installEngineAuth(vi.fn())
    vi.mocked(probeEngineCompatibility).mockResolvedValue({ status: 'compatible', message: 'ok', version: '0.5.0', uptimeSeconds: 5 })
  })

  afterEach(() => {
    disposeAuth()
    delete window.electronAPI
    vi.unstubAllGlobals()
  })

  it('stays signed out at launch without a stored session, and does not prompt', async () => {
    render(<HookHarness />)
    await waitFor(() => expect(useSettingsStore.getState().engineStatus).toBe('unreachable'))
    expect(useSettingsStore.getState().connectionMessage).toBe('Signed out of mira.example.com. Sign in to continue.')
    expect(useTeamServerStore.getState()).toMatchObject({ phase: 'signedOut', login: null })
    expect(probeEngineCompatibility).not.toHaveBeenCalled()
    expect(bootstrapLocalEngine).not.toHaveBeenCalled()
    expect(websocketMock.connect).not.toHaveBeenCalled()
  })

  it('connects through Mira Server once signed in', async () => {
    render(<HookHarness />)
    await waitFor(() => expect(useTeamServerStore.getState().phase).toBe('signedOut'))
    await act(async () => { await loginTeamServer(ORIGIN, 'alice', 'correct horse') })
    await waitFor(() => expect(probeEngineCompatibility).toHaveBeenCalledWith(`${ORIGIN}/api`))
    expect(server.requests.some((r) => r.path === '/server/me')).toBe(true)
    await waitFor(() => expect(websocketMock.connect).toHaveBeenCalled())
    expect(useTeamServerStore.getState().engine).toMatchObject({ state: 'running' })
  })

  it('uses a stored session silently at launch', async () => {
    await bridge.manager.login(ORIGIN, 'alice', 'correct horse')
    resetTeamServerAuthForTests()
    render(<HookHarness />)
    await waitFor(() => expect(websocketMock.connect).toHaveBeenCalled())
    expect(useTeamServerStore.getState()).toMatchObject({ phase: 'signedIn', login: null })
  })

  it('reports an engine held elsewhere instead of probing', async () => {
    await bridge.manager.login(ORIGIN, 'alice', 'correct horse')
    server.state.engineState = 'conflict'
    render(<HookHarness />)
    await waitFor(() => expect(useSettingsStore.getState().connectionMessage).toContain('already running outside Mira Server'))
    expect(probeEngineCompatibility).not.toHaveBeenCalled()
  })

  it('does not look for an engine for an account that only administers the team', async () => {
    await bridge.manager.login(ORIGIN, 'dana', 'admin only')
    render(<HookHarness />)
    await waitFor(() => expect(useSettingsStore.getState().engineStatus).toBe('unreachable'))
    expect(useSettingsStore.getState().connectionMessage).toContain('as an administrator without a workspace')
    expect(probeEngineCompatibility).not.toHaveBeenCalled()
    expect(websocketMock.connect).not.toHaveBeenCalled()
    expect(server.requests.some((r) => r.path === '/server/engine/start')).toBe(false)
  })

  it('keeps the WebSocket on token refresh and drops it when the session ends', async () => {
    await bridge.manager.login(ORIGIN, 'alice', 'correct horse')
    render(<HookHarness />)
    await waitFor(() => expect(websocketMock.connect).toHaveBeenCalled())
    websocketMock.disconnect.mockClear()

    await act(async () => { await bridge.manager.refresh(ORIGIN) })
    expect(websocketMock.disconnect).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().engineStatus).toBe('compatible')

    await act(async () => { await bridge.manager.logout(ORIGIN) })
    await waitFor(() => expect(useSettingsStore.getState().engineStatus).toBe('unreachable'))
    expect(useSettingsStore.getState().connectionMessage).toBe('Signed out of mira.example.com. Sign in to continue.')
    expect(websocketMock.disconnect).toHaveBeenCalled()
  })
})
