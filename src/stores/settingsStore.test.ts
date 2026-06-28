import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from './settingsStore'
import type { RuntimeConfigPayload } from '@/services/runtimeConfig'

const initialState = useSettingsStore.getState()

function installLocalStorageStub() {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key)
    }),
  })
}

function runtimePayload(workspace: string, configPath: string): RuntimeConfigPayload {
  return {
    projects_root: workspace,
    config_path: configPath,
    persisted: true,
    runtime: {
      workspace,
      workspace_resolved: workspace,
      provider: 'custom',
      model: 'custom/test',
      reasoning_effort: null,
      temperature: 0.1,
      max_tool_iterations: 200,
      restrict_to_workspace: false,
    },
    providers: {},
  }
}

describe('settingsStore', () => {
  beforeEach(() => {
    installLocalStorageStub()
    localStorage.removeItem?.('mira-ui-settings')
    localStorage.removeItem?.('medpilot-ui-settings')
    useSettingsStore.setState(initialState, true)
  })

  afterEach(() => {
    // Avoid leaking the partial localStorage stub into other test files.
    vi.unstubAllGlobals()
  })

  it('defaults to light theme with quiet optional history and prerelease updates off', () => {
    const state = useSettingsStore.getState()

    expect(state.theme).toBe('light')
    expect(state.showToolCallHistory).toBe(false)
    expect(state.receivePrereleases).toBe(false)
  })

  it('persists user setting changes to local storage', () => {
    const store = useSettingsStore.getState()

    store.setTheme('dark')
    store.setShowToolCallHistory(true)
    store.setReceivePrereleases(true)

    const persisted = JSON.parse(localStorage.getItem('mira-ui-settings') ?? '{}')
    expect(persisted.theme).toBe('dark')
    expect(persisted.showToolCallHistory).toBe(true)
    expect(persisted.receivePrereleases).toBe(true)
  })

  it('switches to local bundle mode with fixed localhost endpoints', () => {
    useSettingsStore.getState().setDeploymentMode('localBundle')

    const state = useSettingsStore.getState()
    expect(state.deploymentMode).toBe('localBundle')
    expect(state.apiUrl).toBe('http://127.0.0.1:18790/api')
    expect(state.wsUrl).toBe('ws://127.0.0.1:18790/ws')
  })

  it('does not reset custom remote endpoints when remote mode is reapplied', () => {
    useSettingsStore.getState().setConnectionEndpoints('https://gateway.example/api', 'wss://gateway.example/ws')
    useSettingsStore.getState().setDeploymentMode('remoteManual')

    const state = useSettingsStore.getState()
    expect(state.deploymentMode).toBe('remoteManual')
    expect(state.apiUrl).toBe('https://gateway.example/api')
    expect(state.wsUrl).toBe('wss://gateway.example/ws')
  })

  it('stores local engine bootstrap metadata', () => {
    useSettingsStore.getState().setLocalEngineBootstrap({
      phase: 'ready',
      message: 'Local engine is ready.',
      executablePath: '/tmp/mira-engine',
      version: '0.2.0',
      operation: null,
    })

    const state = useSettingsStore.getState()
    expect(state.localEnginePhase).toBe('ready')
    expect(state.localEngineOperation).toBeNull()
    expect(state.localEngineExecutablePath).toBe('/tmp/mira-engine')
    expect(state.engineVersion).toBe('0.2.0')
    expect(state.engineMessage).toBe('Local engine is ready.')
  })

  it('anchors engine start time from the reported uptime and keeps it stable across probes', () => {
    const before = Date.now()
    useSettingsStore.getState().setEngineBootstrap({
      status: 'compatible',
      message: null,
      version: '0.3.0',
      uptimeSeconds: 120,
    })

    const anchored = useSettingsStore.getState().engineStartedAt
    expect(anchored).not.toBeNull()
    // ~120s ago, allowing for execution time.
    expect(anchored!).toBeLessThanOrEqual(before - 120_000 + 1000)
    expect(anchored!).toBeGreaterThanOrEqual(before - 120_000 - 1000)

    // A subsequent probe with a consistent (slightly later) uptime must not
    // re-anchor, so the top-bar timer stays stable.
    useSettingsStore.getState().setEngineBootstrap({
      status: 'compatible',
      message: null,
      version: '0.3.0',
      uptimeSeconds: 121,
    })
    expect(useSettingsStore.getState().engineStartedAt).toBe(anchored)
  })

  it('clears engine start time when the engine becomes unreachable', () => {
    useSettingsStore.getState().setEngineBootstrap({
      status: 'compatible',
      message: null,
      version: '0.3.0',
      uptimeSeconds: 30,
    })
    expect(useSettingsStore.getState().engineStartedAt).not.toBeNull()

    useSettingsStore.getState().setEngineBootstrap({
      status: 'unreachable',
      message: 'gone',
      version: null,
    })
    expect(useSettingsStore.getState().engineStartedAt).toBeNull()
  })

  it('re-anchors engine start time after a restart resets uptime', () => {
    useSettingsStore.getState().setEngineBootstrap({
      status: 'compatible',
      message: null,
      version: '0.3.0',
      uptimeSeconds: 3600,
    })
    const firstAnchor = useSettingsStore.getState().engineStartedAt

    useSettingsStore.getState().setEngineBootstrap({
      status: 'compatible',
      message: null,
      version: '0.3.0',
      uptimeSeconds: 2,
    })
    const secondAnchor = useSettingsStore.getState().engineStartedAt

    expect(secondAnchor).not.toBe(firstAnchor)
    expect(secondAnchor!).toBeGreaterThan(firstAnchor!)
  })

  it('keeps workspace paths scoped to each engine profile', () => {
    useSettingsStore.getState().setDeploymentMode('localBundle')
    useSettingsStore.getState().setRuntimeConfig(runtimePayload('/local/workspace', '/local/config.json'))

    useSettingsStore.getState().setDeploymentMode('remoteManual')
    useSettingsStore.getState().setConnectionEndpoints('https://remote.example/api', 'wss://remote.example/ws')
    useSettingsStore.getState().setRuntimeConfig(runtimePayload('/remote/workspace', '/remote/config.json'))

    expect(useSettingsStore.getState().workspacePath).toBe('/remote/workspace')

    useSettingsStore.getState().setDeploymentMode('localBundle')
    expect(useSettingsStore.getState().workspacePath).toBe('/local/workspace')

    useSettingsStore.getState().setDeploymentMode('remoteManual')
    const state = useSettingsStore.getState()
    expect(state.apiUrl).toBe('https://remote.example/api')
    expect(state.workspacePath).toBe('/remote/workspace')
  })
})
