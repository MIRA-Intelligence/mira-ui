import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const websocketMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}))

vi.mock('@/services/websocket', () => ({
  wsClient: websocketMock,
}))

vi.mock('@/services/desktop', () => ({
  hasDesktopEngineManager: vi.fn(() => true),
  bootstrapLocalEngine: vi.fn(),
}))

vi.mock('@/services/engine', () => ({
  probeEngineCompatibility: vi.fn(),
}))

import { useWebSocket } from './useWebSocket'
import { bootstrapLocalEngine } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'

function HookHarness() {
  useWebSocket()
  return null
}

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      deploymentMode: 'localBundle',
      apiUrl: 'http://127.0.0.1:18790/api',
      wsUrl: 'ws://127.0.0.1:18790/ws',
      engineStatus: 'unknown',
      engineMessage: null,
      engineVersion: null,
      localEnginePhase: 'idle',
      localEngineExecutablePath: null,
    })
    useAgentStore.setState({
      connected: false,
      isStreaming: false,
      logsByProject: {},
    })
    vi.mocked(bootstrapLocalEngine).mockResolvedValue({
      phase: 'ready',
      message: 'Local engine is ready.',
      executablePath: 'C:\\Program Files\\MIRA\\mira-engine.exe',
      version: '0.2.0',
    })
  })

  it('connects websocket after local engine moves from setup_required to compatible', async () => {
    vi.mocked(probeEngineCompatibility).mockResolvedValue({
      status: 'setup_required',
      message: 'Local engine is running, but model access is still unconfigured.',
      version: '0.2.0',
    })

    render(<HookHarness />)

    await waitFor(() => {
      expect(probeEngineCompatibility).toHaveBeenCalledWith('http://127.0.0.1:18790/api')
    })

    expect(useSettingsStore.getState().engineStatus).toBe('setup_required')
    expect(websocketMock.connect).not.toHaveBeenCalled()

    act(() => {
      useSettingsStore.getState().setEngineBootstrap({
        status: 'compatible',
        message: null,
        version: '0.2.0',
      })
    })

    await waitFor(() => {
      expect(websocketMock.onMessage).toHaveBeenCalledTimes(1)
      expect(websocketMock.onStatus).toHaveBeenCalledTimes(1)
      expect(websocketMock.connect).toHaveBeenCalledTimes(1)
    })
  })
})
