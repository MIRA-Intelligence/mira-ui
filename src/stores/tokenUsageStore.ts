import { create } from 'zustand'
import { fetchTokenUsage } from '@/services/api'

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  calls: number
  unreported_calls: number
  // Optional for older engines. Missing coverage must never imply a cache miss.
  cache_reported_calls?: number
}

function valid(value: unknown): value is TokenUsage {
  if (!value || typeof value !== 'object') return false
  const data = value as TokenUsage
  return (['input_tokens', 'output_tokens', 'total_tokens', 'cached_tokens', 'calls', 'unreported_calls'] as const)
    .every((key) => Number.isSafeInteger(data[key]) && data[key] >= 0)
    && data.cached_tokens <= data.input_tokens && data.unreported_calls <= data.calls
    && (data.cache_reported_calls === undefined || (Number.isSafeInteger(data.cache_reported_calls)
      && data.cache_reported_calls >= 0 && data.cache_reported_calls <= data.calls))
}

let epoch = 0
const pending = new Map<string, Promise<void>>()
export const useTokenUsageStore = create<{
  snapshots: Record<string, TokenUsage>
  ingest: (id: string, value: unknown) => void
  load: (id: string) => Promise<void>
  reset: () => void
}>((set, get) => ({
  snapshots: {},
  ingest: (id, value) => {
    if (!valid(value)) return
    set((state) => {
      const old = state.snapshots[id]
      // REST and parallel call notifications can arrive out of order.
      if (old && (old.calls > value.calls || (old.calls === value.calls
        && (old.cache_reported_calls ?? 0) >= (value.cache_reported_calls ?? 0)))) return state
      return { snapshots: { ...state.snapshots, [id]: value } }
    })
  },
  load: (id) => {
    const existing = pending.get(id)
    if (existing) return existing
    const startedEpoch = epoch
    const request = (async () => {
      try {
        const value = await fetchTokenUsage(id)
        if (startedEpoch === epoch) get().ingest(id, value)
      } catch { /* Unknown is displayed as a dash, not fabricated zero usage. */ }
      finally { if (startedEpoch === epoch) pending.delete(id) }
    })()
    pending.set(id, request)
    return request
  },
  reset: () => {
    epoch += 1
    pending.clear()
    set({ snapshots: {} })
  },
}))
