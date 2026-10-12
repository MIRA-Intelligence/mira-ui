import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSkillHistory } from '@/services/api'
import { useSkillHistoryStore } from './skillHistoryStore'
import { useAgentStore } from './agentStore'
import type { SkillLoadEvent } from '@/types'

vi.mock('@/services/api', async (original) => ({ ...await original<typeof import('@/services/api')>(), fetchSkillHistory: vi.fn() }))
const event = (id: string): SkillLoadEvent => ({ id, skill_name: 'demo', source: 'manual', loaded_at: `2026-10-12T10:00:0${id}Z`, partial: false })
const store = () => useSkillHistoryStore.getState()

describe('skill history', () => {
  beforeEach(() => { store().reset(); vi.clearAllMocks() })

  it('deduplicates live IDs but retains repeat loads and isolates sessions', () => {
    store().ingest('a', event('1')); store().ingest('a', event('1')); store().ingest('a', event('2'))
    store().ingest('b', event('3')); store().ingest('a', { id: 'invalid' })
    expect(store().events.a.map((e) => e.id)).toEqual(['1', '2'])
    expect(store().liveIds.a).toEqual(['1', '2'])
    expect(store().events.b).toHaveLength(1)
  })

  it('merges history arriving after a live event without replaying it', async () => {
    let resolve!: (value: { events: SkillLoadEvent[]; next_cursor: null }) => void
    vi.mocked(fetchSkillHistory).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const loading = store().load('a')
    store().ingest('a', event('2'))
    resolve({ events: [event('1'), event('2')], next_cursor: null })
    await loading
    expect(store().events.a.map((e) => e.id)).toEqual(['1', '2'])
    expect(store().liveIds.a).toEqual(['2'])
  })

  it('pages through reconnect gaps even when previous history was complete', async () => {
    vi.mocked(fetchSkillHistory).mockResolvedValueOnce({ events: [event('1')], next_cursor: null })
      .mockResolvedValueOnce({ events: [event('3')], next_cursor: 10 })
      .mockResolvedValueOnce({ events: [event('1'), event('2')], next_cursor: null })
    await store().load('a'); await store().load('a')
    expect(store().cursors.a).toBe(10)
    await store().load('a', true)
    expect(fetchSkillHistory).toHaveBeenLastCalledWith('a', 10)
    expect(store().events.a.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('ignores responses from a previous workspace/server', async () => {
    let resolve!: (value: { events: SkillLoadEvent[]; next_cursor: null }) => void
    vi.mocked(fetchSkillHistory).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const loading = store().load('a')
    store().reset()
    resolve({ events: [event('1')], next_cursor: null }); await loading
    expect(store().events).toEqual({})
  })

  it('does not turn skill notifications into chat or streaming output', () => {
    const before = useAgentStore.getState()
    before.handleWsMessage({ type: 'skill_loaded', session_id: 'a', content: '', metadata: { skill_event: event('1') } })
    expect(store().events.a).toEqual([event('1')])
    expect(useAgentStore.getState().logsByProject).toBe(before.logsByProject)
    expect(useAgentStore.getState().streamingBySession).toBe(before.streamingBySession)
  })

  it('reports an unavailable/older engine without clearing live records', async () => {
    store().ingest('a', event('1'))
    vi.mocked(fetchSkillHistory).mockRejectedValueOnce(new Error('unsupported'))
    await store().load('a')
    expect(store().errors.a).toBe('unsupported')
    expect(store().events.a).toHaveLength(1)
  })
})
