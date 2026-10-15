import { StrictMode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import { StatusBar } from './StatusBar'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useSkillHistoryStore } from '@/stores/skillHistoryStore'
import { useTokenUsageStore } from '@/stores/tokenUsageStore'

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
const initialChatState = useChatStore.getState()

describe('StatusBar', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useAgentStore.setState(initialAgentState, true)
    useUiStore.setState(initialUiState, true)
    useChatStore.setState(initialChatState, true)
    useSkillHistoryStore.getState().reset()
    useTokenUsageStore.getState().reset()

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

  it('follows Quick Chat versus project selection without mixing skill histories', () => {
    useAgentStore.setState({ connected: false })
    useProjectStore.setState({ appMode: 'project', selectedTaskId: 'PRJ-a' })
    useChatStore.setState({ activeChatId: 'chat-b' })
    for (const [session, name] of [['PRJ-a', 'project-skill'], ['chat-b', 'chat-skill']]) {
      useSkillHistoryStore.getState().ingest(session, {
        id: session, skill_name: name, source: 'manual', partial: false, loaded_at: '2026-10-12T10:00:00Z',
      })
    }
    render(<StatusBar />)
    expect(screen.getByRole('button', { name: 'Skill load history' })).toHaveTextContent('$project-skill')
    act(() => useProjectStore.setState({ appMode: 'normal' }))
    expect(screen.getByRole('button', { name: 'Skill load history' })).toHaveTextContent('$chat-skill')
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
          temperature: 0.1,
          max_tool_iterations: 32,
          auto_max_rounds: 100,
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

  it('shows the live local engine phase in the engine chip while bootstrapping', () => {
    useSettingsStore.setState({
      localEnginePhase: 'updating',
      engineMessage: 'Updating local engine service...',
    })
    render(<StatusBar />)
    expect(screen.getByText('Phase: updating')).toBeInTheDocument()
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
    expect(screen.getByText('₿')).toBeInTheDocument()
    expect(container.querySelector('footer')).toBeInTheDocument()
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

  it('shows live Quick Chat usage immediately to the right of skills without adding logs', () => {
    useProjectStore.setState({ appMode: 'normal', selectedTaskId: 'other-project' })
    useChatStore.setState({ activeChatId: 'chat-one' })
    render(<StatusBar />)
    act(() => useAgentStore.getState().handleWsMessage({
      type: 'token_usage', session_id: 'chat-one', content: '', metadata: { token_usage: {
        input_tokens: 1000, output_tokens: 500, total_tokens: 1500, cached_tokens: 200, calls: 1, unreported_calls: 0, cache_reported_calls: 1,
      } },
    }))
    const coin = screen.getByText('₿').parentElement!
    expect(coin.parentElement!.previousElementSibling).toContainElement(screen.getByRole('button', { name: 'Skill load history' }))
    expect(screen.getByText('1.5K')).toBeInTheDocument()
    expect(coin.title).toContain('Cached input 200 (included in input)')
    expect(useAgentStore.getState().logsByProject['chat-one']).toBeUndefined()
    expect(useAgentStore.getState().streamingBySession['chat-one']).toBeUndefined()
    act(() => useChatStore.setState({ activeChatId: 'chat-two' }))
    expect(screen.queryByText('1.5K')).not.toBeInTheDocument()
  })

  it('marks missing provider usage as incomplete rather than zero consumption', () => {
    useProjectStore.setState({ selectedTaskId: 'PRJ-partial', appMode: 'project' })
    useTokenUsageStore.getState().ingest('PRJ-partial', {
      input_tokens: 100, output_tokens: 50, total_tokens: 150, cached_tokens: 0, calls: 2, unreported_calls: 1,
    })
    render(<StatusBar />)
    expect(screen.getByText('≥ 150')).toBeInTheDocument()
    expect(screen.getByText('₿').parentElement?.title).toContain('incomplete')
  })

  it('opens token details, updates live, dismisses and isolates sessions', () => {
    useAgentStore.setState({ connected: false })
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({ activeChatId: 'chat-one' })
    const snapshot = { input_tokens: 14000, output_tokens: 100, total_tokens: 14100,
      cached_tokens: 10000, calls: 1, unreported_calls: 0, cache_reported_calls: 1 }
    useTokenUsageStore.getState().ingest('chat-one', snapshot)
    render(<StatusBar />)
    const button = screen.getByRole('button', { name: 'Token usage details' })
    fireEvent.click(button)
    let dialog = screen.getByRole('dialog', { name: 'Token usage details' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('14,100')).toBeInTheDocument()
    expect(within(dialog).getByText('10,000')).toBeInTheDocument()
    expect(within(dialog).getByText('4,000')).toBeInTheDocument()
    expect(within(dialog).getByText('71.4%')).toBeInTheDocument()
    act(() => useTokenUsageStore.getState().ingest('chat-one', { ...snapshot,
      input_tokens: 28000, total_tokens: 28100, cached_tokens: 20000, calls: 2, cache_reported_calls: 2 }))
    expect(within(dialog).getByText('28,100')).toBeInTheDocument()
    expect(within(dialog).getByText('20,000')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(button)
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close token details' }))
    expect(button).toHaveFocus()
    fireEvent.click(button)
    act(() => useChatStore.setState({ activeChatId: 'chat-two' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    [undefined, 0, 'Unknown'], [0, 0, 'Unknown'], [1, 0, 'Unknown'],
    [1, 80, '≥ 80'], [2, 0, '0'], [2, 80, '80'],
  ])('distinguishes cache coverage %s and value %s', (reported, cached, expected) => {
    useAgentStore.setState({ connected: false })
    useProjectStore.setState({ appMode: 'project', selectedTaskId: 'project-one' })
    useTokenUsageStore.getState().ingest('project-one', {
      input_tokens: 200, output_tokens: 10, total_tokens: 210, cached_tokens: cached as number,
      calls: 2, unreported_calls: 0, cache_reported_calls: reported,
    })
    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Token usage details' }))
    const row = screen.getByText('Cache-read tokens (part of input)').parentElement!
    expect(within(row).getByText(expected as string)).toBeInTheDocument()
    if (reported !== 2) expect(screen.getByText(/Unknown does not mean a cache miss/)).toBeInTheDocument()
  })

  it('supports Chinese details and missing usage', () => {
    useAgentStore.setState({ connected: false })
    useSettingsStore.setState({ language: 'zh' })
    useProjectStore.setState({ appMode: 'project', selectedTaskId: 'project-one' })
    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Token 使用明细' }))
    expect(screen.getByText(/详细用量尚不可用/)).toBeInTheDocument()
    act(() => useTokenUsageStore.getState().ingest('project-one', {
      input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0,
      calls: 1, unreported_calls: 1, cache_reported_calls: 0,
    }))
    expect(screen.getByText(/部分调用未返回 token 用量/)).toBeInTheDocument()
    expect(screen.getByText(/未知不代表未命中/)).toBeInTheDocument()
  })

  it('explains a rejected engine token and links to settings in remote mode', () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual', engineAuthRejected: true, settingsOpen: false })
    render(<StatusBar />)

    expect(screen.getByText(/token is missing or invalid/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
  })
})
