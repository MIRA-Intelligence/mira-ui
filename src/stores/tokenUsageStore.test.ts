import { beforeEach, expect, it, vi } from 'vitest'
import { fetchTokenUsage } from '@/services/api'
import { useTokenUsageStore } from './tokenUsageStore'

vi.mock('@/services/api', () => ({ fetchTokenUsage: vi.fn() }))
const snapshot = (calls: number) => ({ input_tokens: calls * 100, output_tokens: calls * 10,
  total_tokens: calls * 110, cached_tokens: 0, calls, unreported_calls: 0 })
beforeEach(() => { vi.clearAllMocks(); useTokenUsageStore.getState().reset() })

it('deduplicates simultaneous hydration and ignores an older REST snapshot after live events', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(fetchTokenUsage).mockImplementation(() => new Promise((done) => { resolve = done }))
  const first = useTokenUsageStore.getState().load('one')
  const second = useTokenUsageStore.getState().load('one')
  expect(fetchTokenUsage).toHaveBeenCalledTimes(1)
  useTokenUsageStore.getState().ingest('one', snapshot(3))
  resolve(snapshot(1))
  await Promise.all([first, second])
  expect(useTokenUsageStore.getState().snapshots.one.total_tokens).toBe(330)
})

it('ignores malformed updates, duplicates and out-of-order events', () => {
  const store = useTokenUsageStore.getState()
  store.ingest('one', snapshot(2))
  store.ingest('one', snapshot(1))
  store.ingest('one', { ...snapshot(3), total_tokens: -1 })
  store.ingest('one', { ...snapshot(3), input_tokens: '100' })
  store.ingest('two', snapshot(1))
  expect(useTokenUsageStore.getState().snapshots.one).toEqual(snapshot(2))
  expect(useTokenUsageStore.getState().snapshots.two).toEqual(snapshot(1))
})

it('does not import a stale response after workspace reset', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(fetchTokenUsage).mockImplementation(() => new Promise((done) => { resolve = done }))
  const request = useTokenUsageStore.getState().load('one')
  useTokenUsageStore.getState().reset()
  resolve(snapshot(9))
  await request
  expect(useTokenUsageStore.getState().snapshots).toEqual({})
})

it('loads persisted zero or positive counters but leaves unavailable usage unknown', async () => {
  vi.mocked(fetchTokenUsage).mockResolvedValueOnce(snapshot(0)).mockResolvedValueOnce(snapshot(5)).mockRejectedValueOnce(new Error('offline'))
  await useTokenUsageStore.getState().load('empty')
  await useTokenUsageStore.getState().load('historical')
  await useTokenUsageStore.getState().load('unavailable')
  expect(useTokenUsageStore.getState().snapshots.empty.calls).toBe(0)
  expect(useTokenUsageStore.getState().snapshots.historical.total_tokens).toBe(550)
  expect(useTokenUsageStore.getState().snapshots.unavailable).toBeUndefined()
})

it('preserves cache coverage and enriches same-call snapshots without rolling back', () => {
  const store = useTokenUsageStore.getState()
  store.ingest('one', snapshot(2))
  store.ingest('one', { ...snapshot(2), cached_tokens: 100, cache_reported_calls: 2 })
  store.ingest('one', snapshot(2))
  expect(useTokenUsageStore.getState().snapshots.one.cache_reported_calls).toBe(2)
  expect(useTokenUsageStore.getState().snapshots.one.cached_tokens).toBe(100)
  store.ingest('one', { ...snapshot(3), cache_reported_calls: -1 })
  store.ingest('one', { ...snapshot(3), cache_reported_calls: 4 })
  store.ingest('one', { ...snapshot(3), cached_tokens: 999 })
  expect(useTokenUsageStore.getState().snapshots.one.calls).toBe(2)
})
