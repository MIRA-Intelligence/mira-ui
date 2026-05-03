import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import { StatusBar } from './StatusBar'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore } from '@/stores/uiStore'

function pushUsage(sessionId: string, tokensUsed: number, maxTokens: number | null) {
  useAgentStore.getState().handleWsMessage({
    type: 'progress',
    session_id: sessionId,
    content: '...',
    metadata:
      maxTokens != null
        ? { tokens_used_session: tokensUsed, max_tokens: maxTokens }
        : { tokens_used_session: tokensUsed },
  })
}

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

  it('shows the websocket error message in the status bar banner', () => {
    useAgentStore.setState({ connected: false })
    useSettingsStore.setState({
      deploymentMode: 'remoteManual',
      connectionMessage: 'Unable to connect to ws://example/ws. Check proxy upgrade headers.',
    })
    render(<StatusBar />)
    expect(
      screen.getByText('Unable to connect to ws://example/ws. Check proxy upgrade headers.'),
    ).toBeInTheDocument()
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

  it('hides the token chip when no project is selected or no usage has arrived', () => {
    const { container } = render(<StatusBar />)
    expect(
      container.querySelector('polygon[points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"]'),
    ).toBeNull()
  })

  it('shows tokensUsed/budget for the selected project', () => {
    useProjectStore.setState({ selectedTaskId: 'PRJ-X' })
    act(() => pushUsage('PRJ-X', 12_500, 100_000))
    const { container } = render(<StatusBar />)
    expect(screen.getByText('13K / 100K')).toBeInTheDocument()
    expect(
      container.querySelector('polygon[points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"]'),
    ).not.toBeNull()
  })

  it('shows tokensUsed without a budget when no automation policy is set', () => {
    useProjectStore.setState({ selectedTaskId: 'PRJ-Y' })
    act(() => pushUsage('PRJ-Y', 850, null))
    render(<StatusBar />)
    expect(screen.getByText('850')).toBeInTheDocument()
  })

  it('formats large token counts with K and M suffixes', () => {
    useProjectStore.setState({ selectedTaskId: 'PRJ-Z' })
    act(() => pushUsage('PRJ-Z', 2_500_000, null))
    render(<StatusBar />)
    expect(screen.getByText('2.5M')).toBeInTheDocument()
  })
})
