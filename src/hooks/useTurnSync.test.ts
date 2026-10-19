import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'
import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { syncTurns, TURN_SYNC_INTERVAL_MS, useTurnSync } from './useTurnSync'

const initialAgentState = useAgentStore.getState()

describe('useTurnSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState({ appMode: 'normal', selectedTaskId: null })
    useChatStore.setState({ activeChatId: 'chat-open' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks about every busy session and the open one', async () => {
    const fetchTurns = vi.spyOn(api, 'fetchActiveTurns').mockResolvedValue([])
    useAgentStore.setState({ streamingBySession: { 'PRJ-1:run:r1': true, 'PRJ-2': false } })

    await syncTurns()

    expect(fetchTurns.mock.calls.map((call) => call[0]).sort()).toEqual(['PRJ-1', 'chat-open'])
  })

  it('leaves state alone when the engine cannot answer', async () => {
    vi.spyOn(api, 'fetchActiveTurns').mockResolvedValue(null)
    useAgentStore.setState({ streamingBySession: { 'PRJ-1': true } })

    await syncTurns(['PRJ-1'])

    expect(useAgentStore.getState().streamingBySession['PRJ-1']).toBe(true)
    expect(useAgentStore.getState().turnEventsSupported).toBe(false)
  })

  it('syncs on connect and then only while something looks busy', async () => {
    vi.useFakeTimers()
    const fetchTurns = vi.spyOn(api, 'fetchActiveTurns').mockResolvedValue([])
    useAgentStore.setState({ connected: true })

    renderHook(() => useTurnSync())
    expect(fetchTurns).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(TURN_SYNC_INTERVAL_MS)
    expect(fetchTurns).toHaveBeenCalledTimes(1)

    useAgentStore.setState({ streamingBySession: { 'chat-open': true } })
    await vi.advanceTimersByTimeAsync(TURN_SYNC_INTERVAL_MS)
    expect(fetchTurns).toHaveBeenCalledTimes(2)
  })
})
