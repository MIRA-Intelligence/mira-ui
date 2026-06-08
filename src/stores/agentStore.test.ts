import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentStore } from './agentStore'
import { useProjectStore } from './projectStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()

describe('agentStore hydrateLogs', () => {
  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
  })

  it('hydrates full history when project logs are empty', () => {
    const history = [
      {
        id: 'history-PRJ-0005-0-user',
        timestamp: '2026-04-08T10:00:00.000Z',
        content: 'first question',
        type: 'response' as const,
        metadata: { _user: true },
      },
      {
        id: 'history-PRJ-0005-1-assistant',
        timestamp: '2026-04-08T10:00:03.000Z',
        content: 'first answer',
        type: 'response' as const,
        metadata: {},
      },
    ]

    useAgentStore.getState().hydrateLogs('PRJ-0005', history)
    expect(useAgentStore.getState().logsByProject['PRJ-0005']).toEqual(history)
  })

  it('merges missing history even when recent logs already exist', () => {
    useAgentStore.setState({
      logsByProject: {
        'PRJ-0005': [
          {
            id: 'live-user',
            timestamp: '2026-04-08T10:00:00.000Z',
            content: 'first question',
            type: 'response',
            metadata: { _user: true },
          },
          {
            id: 'live-assistant-latest',
            timestamp: '2026-04-08T10:10:00.000Z',
            content: 'latest response only in memory',
            type: 'response',
            metadata: {},
          },
        ],
      },
    })

    const history = [
      {
        id: 'history-PRJ-0005-0-user',
        timestamp: '2026-04-08T10:00:00.000Z',
        content: 'first question',
        type: 'response' as const,
        metadata: { _user: true },
      },
      {
        id: 'history-PRJ-0005-1-assistant',
        timestamp: '2026-04-08T10:00:03.000Z',
        content: 'first answer',
        type: 'response' as const,
        metadata: {},
      },
    ]

    const store = useAgentStore.getState()
    store.hydrateLogs('PRJ-0005', history)
    store.hydrateLogs('PRJ-0005', history)

    expect(useAgentStore.getState().logsByProject['PRJ-0005']).toEqual([
      history[0],
      history[1],
      {
        id: 'live-assistant-latest',
        timestamp: '2026-04-08T10:10:00.000Z',
        content: 'latest response only in memory',
        type: 'response',
        metadata: {},
      },
    ])
  })
})

describe('agentStore plan refreshes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('forces plan entry when a project response advertises pending questions', () => {
    const refreshPlan = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ refreshPlan })

    useAgentStore.getState().handleWsMessage({
      type: 'response',
      session_id: 'PRJ-0001',
      content: 'Plan questions are ready',
      metadata: { _plan_phase: 'questions' },
    })

    expect(refreshPlan).toHaveBeenCalledWith('PRJ-0001', { enterPlan: true })
  })

  it('refreshes custom project ids from project metadata', () => {
    const refreshPlan = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ refreshPlan })

    useAgentStore.getState().handleWsMessage({
      type: 'response',
      session_id: 'brain-age-inference',
      content: 'Plan questions are ready',
      metadata: { _plan_phase: 'questions', project_id: 'brain-age-inference' },
    })

    expect(refreshPlan).toHaveBeenCalledWith('brain-age-inference', { enterPlan: true })
  })
})

describe('agentStore token streaming', () => {
  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
  })

  it('accumulates stream deltas into a single growing assistant entry', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'Hel' })
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'lo' })

    const logs = useAgentStore.getState().logsByProject['PRJ-S']
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ type: 'response', content: 'Hello', metadata: { _streaming: true } })
    expect(useAgentStore.getState().isSessionStreaming('PRJ-S')).toBe(true)
  })

  it('finalizes the streamed entry and clears streaming on stream_end', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'done' })
    store.handleWsMessage({ type: 'stream_end', session_id: 'PRJ-S', content: '' })

    const logs = useAgentStore.getState().logsByProject['PRJ-S']
    expect(logs).toHaveLength(1)
    expect(logs[0].content).toBe('done')
    expect(logs[0].metadata?._streaming).toBeUndefined()
    expect(useAgentStore.getState().isSessionStreaming('PRJ-S')).toBe(false)
  })

  it('ignores empty deltas', () => {
    useAgentStore.getState().handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: '' })
    expect(useAgentStore.getState().logsByProject['PRJ-S']).toBeUndefined()
  })
})

describe('agentStore session usage tracking', () => {
  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
  })

  it('parses tokens_used_session and max_tokens from progress metadata', () => {
    useAgentStore.getState().markSessionPending('PRJ-A')
    expect(useAgentStore.getState().isSessionStreaming('PRJ-A')).toBe(true)

    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-A',
      content: '...',
      metadata: { tokens_used_session: 1500, max_tokens: 50_000 },
    })
    const usage = useAgentStore.getState().getSessionUsage('PRJ-A')
    expect(usage).toMatchObject({ tokensUsed: 1500, maxTokens: 50_000 })
    expect(usage?.updatedAt).toBeGreaterThan(0)
  })

  it('keeps the thinking state until a terminal response arrives', () => {
    const store = useAgentStore.getState()
    store.markSessionPending('PRJ-A')
    expect(useAgentStore.getState().isSessionStreaming('PRJ-A')).toBe(true)

    store.handleWsMessage({
      type: 'tool_call',
      session_id: 'PRJ-A',
      content: 'read_file',
    })
    expect(useAgentStore.getState().isSessionStreaming('PRJ-A')).toBe(true)

    store.handleWsMessage({
      type: 'response',
      session_id: 'PRJ-A',
      content: 'final',
    })
    expect(useAgentStore.getState().isSessionStreaming('PRJ-A')).toBe(false)
  })

  it('uses activity pings for liveness without adding chat log entries', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-A',
      content: 'Mira is working...',
      metadata: { _activity_ping: true },
    })

    expect(useAgentStore.getState().isSessionStreaming('PRJ-A')).toBe(true)
    expect(useAgentStore.getState().logsByProject['PRJ-A']).toBeUndefined()
  })

  it('overrides earlier usage when a higher cumulative number arrives', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-A',
      content: 'first',
      metadata: { tokens_used_session: 1500, max_tokens: 50_000 },
    })
    useAgentStore.getState().handleWsMessage({
      type: 'response',
      session_id: 'PRJ-A',
      content: 'final',
      metadata: { tokens_used_session: 2200, max_tokens: 50_000 },
    })
    expect(useAgentStore.getState().getSessionUsage('PRJ-A')).toMatchObject({
      tokensUsed: 2200,
      maxTokens: 50_000,
    })
  })

  it('ignores stale broadcasts that would rewind the cumulative count', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-B',
      content: 'fresh',
      metadata: { tokens_used_session: 5000, max_tokens: 10_000 },
    })
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-B',
      content: 'stale',
      metadata: { tokens_used_session: 1000, max_tokens: 10_000 },
    })
    expect(useAgentStore.getState().getSessionUsage('PRJ-B')?.tokensUsed).toBe(5000)
  })

  it('updates max_tokens without rewinding tokensUsed when the budget changes mid-session', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-C',
      content: 'first',
      metadata: { tokens_used_session: 5000, max_tokens: 10_000 },
    })
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-C',
      content: 'budget bumped, stale token count',
      metadata: { tokens_used_session: 4000, max_tokens: 100_000 },
    })
    expect(useAgentStore.getState().getSessionUsage('PRJ-C')).toMatchObject({
      tokensUsed: 5000,
      maxTokens: 100_000,
    })
  })

  it('omits maxTokens when the engine does not advertise a budget', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-D',
      content: 'no policy',
      metadata: { tokens_used_session: 800 },
    })
    expect(useAgentStore.getState().getSessionUsage('PRJ-D')).toMatchObject({
      tokensUsed: 800,
      maxTokens: null,
    })
  })

  it('ignores malformed metadata so the chip never displays garbage', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-E',
      content: 'bad',
      metadata: { tokens_used_session: 'lots' as unknown as number },
    })
    expect(useAgentStore.getState().getSessionUsage('PRJ-E')).toBeNull()
  })

  it('drops usage when the project is cleared', () => {
    useAgentStore.getState().handleWsMessage({
      type: 'response',
      session_id: 'PRJ-F',
      content: 'final',
      metadata: { tokens_used_session: 7000 },
    })
    useAgentStore.getState().clearLogs('PRJ-F')
    expect(useAgentStore.getState().getSessionUsage('PRJ-F')).toBeNull()
  })

  it('resetSessionUsage drops a single session without touching others', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-G',
      content: '',
      metadata: { tokens_used_session: 100 },
    })
    store.handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-H',
      content: '',
      metadata: { tokens_used_session: 200 },
    })
    useAgentStore.getState().resetSessionUsage('PRJ-G')
    expect(useAgentStore.getState().getSessionUsage('PRJ-G')).toBeNull()
    expect(useAgentStore.getState().getSessionUsage('PRJ-H')?.tokensUsed).toBe(200)
  })

  it('resetWorkspaceState clears workspace-scoped logs and usage without disconnecting', () => {
    const store = useAgentStore.getState()
    store.setConnected(true)
    store.addLog('PRJ-0001', {
      id: 'log-1',
      timestamp: '2026-05-06T00:00:00.000Z',
      content: 'old workspace message',
      type: 'response',
      metadata: {},
    })
    store.handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-0001',
      content: 'old progress',
      metadata: { tokens_used_session: 100 },
    })

    store.resetWorkspaceState()

    expect(useAgentStore.getState().logsByProject).toEqual({})
    expect(useAgentStore.getState().usageBySession).toEqual({})
    expect(useAgentStore.getState().streamingBySession).toEqual({})
    expect(useAgentStore.getState().connected).toBe(true)
  })
})
