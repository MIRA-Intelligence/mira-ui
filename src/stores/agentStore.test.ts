import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentStore } from './agentStore'

const initialAgentState = useAgentStore.getState()

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
