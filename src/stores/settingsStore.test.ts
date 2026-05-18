import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from './settingsStore'
import type { RuntimeConfigPayload } from '@/services/runtimeConfig'

const initialState = useSettingsStore.getState()

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
      max_tool_iterations: 200,
      restrict_to_workspace: false,
    },
    providers: {},
  }
}

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.removeItem?.('mira-ui-settings')
    localStorage.removeItem?.('medpilot-ui-settings')
    useSettingsStore.setState(initialState, true)
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
    })

    const state = useSettingsStore.getState()
    expect(state.localEnginePhase).toBe('ready')
    expect(state.localEngineExecutablePath).toBe('/tmp/mira-engine')
    expect(state.engineVersion).toBe('0.2.0')
    expect(state.engineMessage).toBe('Local engine is ready.')
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
