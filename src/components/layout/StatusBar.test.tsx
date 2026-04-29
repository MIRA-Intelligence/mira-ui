import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import { StatusBar } from './StatusBar'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore } from '@/stores/uiStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialAgentState = useAgentStore.getState()
const initialUiState = useUiStore.getState()

describe('StatusBar', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useAgentStore.setState(initialAgentState, true)
    useUiStore.setState(initialUiState, true)

    useSettingsStore.setState({
      language: 'en',
      deploymentMode: 'localBundle',
      engineStatus: 'compatible',
      engineMessage: null,
      engineVersion: '0.3.0',
      localEnginePhase: 'ready',
    })
    useAgentStore.setState({ connected: true })
  })

  it('renders engine, model placeholder, and ws chips in strict mode', () => {
    expect(() => {
      render(
        <StrictMode>
          <StatusBar />
        </StrictMode>,
      )
    }).not.toThrow()

    expect(screen.getByText('mira-engine 0.3.0')).toBeInTheDocument()
    expect(screen.getByText('No model configured')).toBeInTheDocument()
    expect(screen.getByText('WS connected')).toBeInTheDocument()
  })

  it('renders the configured model when runtime config is present', () => {
    useSettingsStore.setState({
      runtimeConfig: {
        projects_root: '/tmp',
        config_path: '/tmp/cfg.json',
        persisted: true,
        runtime: {
          workspace: '/tmp',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          reasoning_effort: 'medium',
          max_tool_iterations: 32,
          restrict_to_workspace: true,
        },
        providers: {},
      },
    })

    render(<StatusBar />)
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument()
  })

  it('shows ws disconnected chip when agent is not connected', () => {
    useAgentStore.setState({ connected: false })
    render(<StatusBar />)
    expect(screen.getByText('WS disconnected')).toBeInTheDocument()
  })

  it('shows compatibility warning banner when engine is unreachable', () => {
    useSettingsStore.setState({
      engineStatus: 'unreachable',
      engineMessage: 'Engine is unreachable.',
    })
    render(<StatusBar />)
    expect(screen.getByText('Engine is unreachable.')).toBeInTheDocument()
  })

  it('shows setup warning banner when provider configuration is required', () => {
    useSettingsStore.setState({
      engineStatus: 'setup_required',
      engineMessage: 'Local engine is running, but model access is still unconfigured.',
    })
    render(<StatusBar />)
    expect(
      screen.getByText('Local engine is running, but model access is still unconfigured.'),
    ).toBeInTheDocument()
  })

  it('renders the most recent system message in the slot', () => {
    render(<StatusBar />)
    act(() => {
      useUiStore.getState().pushSystemMessage('Loaded 5 projects', { severity: 'info' })
    })
    expect(screen.getByText('Loaded 5 projects')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
