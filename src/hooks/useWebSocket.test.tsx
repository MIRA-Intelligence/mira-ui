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
  getBootstrapState: vi.fn(),
  setEngineModeHint: vi.fn(),
}))

vi.mock('@/services/engine', () => ({
  probeEngineCompatibility: vi.fn(),
}))

const remoteSshMock = vi.hoisted(() => ({
  listeners: [] as Array<(status: unknown) => void>,
  connect: vi.fn(),
  disconnect: vi.fn(async () => ({ phase: 'idle', host: null, localPort: null, version: null, error: null, attempt: 0 })),
}))

vi.mock('@/services/remoteSsh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/remoteSsh')>()
  return {
    ...actual,
    hasRemoteSshBridge: vi.fn(() => true),
    connectRemoteSsh: remoteSshMock.connect,
    disconnectRemoteSsh: remoteSshMock.disconnect,
    getRemoteSshStatus: vi.fn(async () => actual.IDLE_REMOTE_SSH_STATUS),
    onRemoteSshStatus: vi.fn((listener: (status: unknown) => void) => {
      remoteSshMock.listeners.push(listener)
      return () => { remoteSshMock.listeners = remoteSshMock.listeners.filter((item) => item !== listener) }
    }),
  }
})

import { useWebSocket } from './useWebSocket'
import { bootstrapLocalEngine, getBootstrapState } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRemoteSshStore } from '@/stores/remoteSshStore'

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
      streamingBySession: {},
      logsByProject: {},
    })
    vi.mocked(bootstrapLocalEngine).mockResolvedValue({
      phase: 'ready',
      message: 'Local engine is ready.',
      executablePath: 'C:\\Program Files\\MIRA\\mira-engine.exe',
      healthUrl: 'http://127.0.0.1:18790/health',
      version: '0.2.0',
      operation: null,
      serviceInstalled: true,
      serviceRunning: true,
      lastCommand: null,
      error: null,
    })
    vi.mocked(getBootstrapState).mockResolvedValue({
      phase: 'ready',
      message: 'Local engine is ready.',
      executablePath: 'C:\\Program Files\\MIRA\\mira-engine.exe',
      healthUrl: 'http://127.0.0.1:18790/health',
      version: '0.2.0',
      operation: null,
      serviceInstalled: true,
      serviceRunning: true,
      lastCommand: null,
      error: null,
    })
  })

  it('connects websocket after local engine moves from setup_required to compatible', async () => {
    vi.mocked(probeEngineCompatibility).mockResolvedValue({
      status: 'setup_required',
      message: 'Local engine is running, but model access is still unconfigured.',
      version: '0.2.0',
      uptimeSeconds: null,
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

  describe('Remote-SSH', () => {
    const connected = (localPort: number) => ({ phase: 'connected', host: 'lab', localPort, version: '0.5.0', error: null, attempt: 0 })

    beforeEach(() => {
      remoteSshMock.listeners = []
      useSettingsStore.setState({ deploymentMode: 'remoteSsh', sshHost: 'lab', apiUrl: '', wsUrl: '' })
      vi.mocked(probeEngineCompatibility).mockResolvedValue({ status: 'compatible', message: 'ok', version: '0.5.0', uptimeSeconds: null })
    })

    it('attaches over SSH, moves to the tunnel endpoint and probes the engine there', async () => {
      remoteSshMock.connect.mockResolvedValue(connected(51000))

      render(<HookHarness />)

      await waitFor(() => expect(probeEngineCompatibility).toHaveBeenCalledWith('http://127.0.0.1:51000/api'))
      expect(remoteSshMock.connect).toHaveBeenCalledWith('lab', '')
      expect(useSettingsStore.getState()).toMatchObject({
        apiUrl: 'http://127.0.0.1:51000/api',
        wsUrl: 'ws://127.0.0.1:51000/ws',
        activeEngineKey: 'ssh:lab',
      })
      expect(bootstrapLocalEngine).not.toHaveBeenCalled()
      await waitFor(() => expect(websocketMock.connect).toHaveBeenCalled())
    })

    it('reports SSH failures without probing', async () => {
      remoteSshMock.connect.mockResolvedValue({
        phase: 'error', host: 'lab', localPort: null, version: null, attempt: 0,
        error: { code: 'auth_required', message: 'Permission denied (publickey).' },
      })

      render(<HookHarness />)

      await waitFor(() => expect(useSettingsStore.getState().engineStatus).toBe('unreachable'))
      expect(useSettingsStore.getState().connectionMessage).toContain('SSH login to lab failed')
      expect(probeEngineCompatibility).not.toHaveBeenCalled()
      expect(useRemoteSshStore.getState().status.error?.code).toBe('auth_required')
    })

    it('re-attaches with the configured remote command when it changes', async () => {
      remoteSshMock.connect.mockResolvedValue(connected(51000))
      render(<HookHarness />)
      await waitFor(() => expect(probeEngineCompatibility).toHaveBeenCalledWith('http://127.0.0.1:51000/api'))

      act(() => useSettingsStore.getState().setSshMiraCommand('/opt/mira/bin/mira'))
      await waitFor(() => expect(remoteSshMock.connect).toHaveBeenLastCalledWith('lab', '/opt/mira/bin/mira'))
      expect(remoteSshMock.disconnect).not.toHaveBeenCalled()
      expect(useSettingsStore.getState().engineProfiles['ssh:lab'].sshMiraCommand).toBe('/opt/mira/bin/mira')
    })

    it('requires a host before connecting', async () => {
      useSettingsStore.setState({ sshHost: '' })
      render(<HookHarness />)
      await waitFor(() => expect(useSettingsStore.getState().engineStatus).toBe('unreachable'))
      expect(remoteSshMock.connect).not.toHaveBeenCalled()
    })

    it('follows a re-attach to a new local port and disconnects when leaving the mode', async () => {
      remoteSshMock.connect.mockResolvedValue(connected(51000))
      render(<HookHarness />)
      await waitFor(() => expect(probeEngineCompatibility).toHaveBeenCalledWith('http://127.0.0.1:51000/api'))

      act(() => remoteSshMock.listeners.forEach((listener) => listener({ ...connected(0), phase: 'reconnecting', localPort: 51000, attempt: 1 })))
      expect(useSettingsStore.getState().connectionMessage).toContain('reconnecting')

      remoteSshMock.connect.mockResolvedValue(connected(52000))
      act(() => remoteSshMock.listeners.forEach((listener) => listener(connected(52000))))
      await waitFor(() => expect(probeEngineCompatibility).toHaveBeenCalledWith('http://127.0.0.1:52000/api'))
      expect(useSettingsStore.getState().wsUrl).toBe('ws://127.0.0.1:52000/ws')

      act(() => useSettingsStore.getState().setDeploymentMode('localBundle'))
      await waitFor(() => expect(remoteSshMock.disconnect).toHaveBeenCalled())
      expect(useRemoteSshStore.getState().status.phase).toBe('idle')
    })
  })
})
