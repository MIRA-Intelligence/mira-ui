import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from './settingsStore'

const initialState = useSettingsStore.getState()

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
})
