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

  it('does not duplicate the optimistic initial prompt when server history uses a different timestamp', () => {
    // Optimistic user message added on project creation (client timestamp).
    useAgentStore.setState({
      logsByProject: {
        liqa2: [
          {
            id: 'user-1751386752345',
            timestamp: '2026-07-01T08:19:12.345Z',
            content: 'New research project initialized.\n\n## Research Description\n...',
            type: 'response',
            metadata: { _user: true },
          },
        ],
      },
    })

    // Same message loaded back from the engine with the server timestamp.
    const history = [
      {
        id: 'history-liqa2-0-user',
        timestamp: '2026-07-01T16:19:12',
        content: 'New research project initialized.\n\n## Research Description\n...',
        type: 'response' as const,
        metadata: { _user: true },
      },
    ]

    useAgentStore.getState().hydrateLogs('liqa2', history)

    const logs = useAgentStore.getState().logsByProject['liqa2']
    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe('history-liqa2-0-user')
  })

  it('keeps genuinely repeated messages in server history', () => {
    const history = [
      {
        id: 'history-PRJ-0007-0-user',
        timestamp: '2026-04-08T10:00:00.000Z',
        content: 'continue',
        type: 'response' as const,
        metadata: { _user: true },
      },
      {
        id: 'history-PRJ-0007-1-user',
        timestamp: '2026-04-08T10:05:00.000Z',
        content: 'continue',
        type: 'response' as const,
        metadata: { _user: true },
      },
    ]

    useAgentStore.getState().hydrateLogs('PRJ-0007', history)
    expect(useAgentStore.getState().logsByProject['PRJ-0007']).toEqual(history)
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

  it('clears thinking state when auto-run reports a terminal stop reason', () => {
    const refreshPlan = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ refreshPlan })
    const store = useAgentStore.getState()
    store.markSessionPending('PRJ-0001')

    store.handleWsMessage({
      type: 'progress',
      session_id: 'PRJ-0001',
      content: 'auto-run stop reason: queue exhausted, no replan condition met',
    })

    expect(useAgentStore.getState().isSessionStreaming('PRJ-0001')).toBe(false)
    expect(refreshPlan).toHaveBeenCalledWith('PRJ-0001')
  })
})

describe('agentStore token streaming', () => {
  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
  })

  it('accumulates stream deltas into a single growing assistant entry', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'Hel' })
    // The first token shows synchronously; later ones are coalesced per frame.
    expect(useAgentStore.getState().logsByProject['PRJ-S'][0].content).toBe('Hel')
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'l' })
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'o' })
    expect(useAgentStore.getState().logsByProject['PRJ-S'][0].content).toBe('Hel')
    store.flushStreamDeltas()

    const logs = useAgentStore.getState().logsByProject['PRJ-S']
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ type: 'response', content: 'Hello', metadata: { _streaming: true } })
    expect(useAgentStore.getState().isSessionStreaming('PRJ-S')).toBe(true)
  })

  it('withdraws the partial reply on stream_reset and keeps the session busy', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'half-' })
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'baked' })
    store.handleWsMessage({ type: 'stream_reset', session_id: 'PRJ-S', content: '' })
    expect(useAgentStore.getState().logsByProject['PRJ-S']).toEqual([])
    expect(useAgentStore.getState().isSessionStreaming('PRJ-S')).toBe(true)

    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'whole reply' })
    store.handleWsMessage({ type: 'stream_end', session_id: 'PRJ-S', content: '' })
    const logs = useAgentStore.getState().logsByProject['PRJ-S']
    expect(logs.map((e) => e.content)).toEqual(['whole reply'])
  })

  it('flushes buffered deltas before a non-delta event for the session', () => {
    const store = useAgentStore.getState()
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'a' })
    store.handleWsMessage({ type: 'stream_delta', session_id: 'PRJ-S', content: 'b' })
    store.handleWsMessage({ type: 'stream_end', session_id: 'PRJ-S', content: '' })
    const logs = useAgentStore.getState().logsByProject['PRJ-S']
    expect(logs).toHaveLength(1)
    expect(logs[0].content).toBe('ab')
    expect(logs[0].metadata?._streaming).toBeUndefined()
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

describe('agentStore turn lifecycle', () => {
  const send = (type: string, metadata: Record<string, unknown> = {}, content = '') =>
    useAgentStore.getState().handleWsMessage({ type, session_id: 'PRJ-1', content, metadata } as never)

  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays busy across responses and stream ends until turn_finished', () => {
    send('turn_started', { turn_id: 't1' })
    send('stream_delta', {}, 'Let me check')
    send('stream_end')
    send('response', {}, 'interim answer')
    expect(useAgentStore.getState().streamingBySession['PRJ-1']).toBe(true)

    send('turn_finished', { turn_id: 't1', stop_reason: 'max_iterations' })
    const state = useAgentStore.getState()
    expect(state.streamingBySession['PRJ-1']).toBeUndefined()
    expect(state.lastTurnEndBySession['PRJ-1']).toEqual({ turnId: 't1', stopReason: 'max_iterations' })
  })

  it('keys workflow-run turns by run and clears the notice when the next turn starts', () => {
    send('turn_finished', { turn_id: 't1', workflow_run_id: 'run-9', stop_reason: 'max_tokens' })
    expect(useAgentStore.getState().lastTurnEndBySession['PRJ-1:run:run-9']?.stopReason).toBe('max_tokens')

    send('turn_started', { turn_id: 't2', workflow_run_id: 'run-9' })
    const state = useAgentStore.getState()
    expect(state.lastTurnEndBySession['PRJ-1:run:run-9']).toBeUndefined()
    expect(state.streamingBySession['PRJ-1:run:run-9']).toBe(true)
  })

  it('treats an unknown stop reason as completed', () => {
    send('turn_finished', { turn_id: 't1', stop_reason: 'something_new' })
    expect(useAgentStore.getState().lastTurnEndBySession['PRJ-1']?.stopReason).toBe('completed')
  })

  it('still infers busy state from message types for engines without turn events', () => {
    send('tool_call', {}, 'exec')
    expect(useAgentStore.getState().streamingBySession['PRJ-1']).toBe(true)
    send('response', {}, 'done')
    expect(useAgentStore.getState().streamingBySession['PRJ-1']).toBeUndefined()
  })

  it('syncs with the engine: clears stale turns, keeps fresh ones, restores running runs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'))
    send('turn_started', { turn_id: 'old' })
    useAgentStore.getState().markSessionPending('PRJ-2')

    // Just sent: the engine has not reported the turn yet, so keep it.
    useAgentStore.getState().syncActiveTurns('PRJ-2', [])
    expect(useAgentStore.getState().streamingBySession['PRJ-2']).toBe(true)

    vi.setSystemTime(new Date('2026-10-19T10:01:00Z'))
    useAgentStore.getState().syncActiveTurns('PRJ-1', [{ turn_id: 'r', workflow_run_id: 'run-3' }])
    const state = useAgentStore.getState()
    expect(state.streamingBySession['PRJ-1']).toBeUndefined()
    expect(state.streamingBySession['PRJ-1:run:run-3']).toBe(true)
  })

  it('keeps inferring from messages when /turns answers but no turn events arrive', () => {
    useAgentStore.getState().syncActiveTurns('PRJ-1', [])
    expect(useAgentStore.getState().turnEventsSupported).toBe(false)
    send('tool_call', {}, 'exec')
    expect(useAgentStore.getState().streamingBySession['PRJ-1']).toBe(true)
  })

  it('relearns turn-event support after a reconnect', () => {
    send('turn_started', { turn_id: 't1' })
    useAgentStore.getState().setConnected(true)
    useAgentStore.getState().setConnected(false)
    expect(useAgentStore.getState().turnEventsSupported).toBe(false)
  })
})
