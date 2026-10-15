import { create } from 'zustand'
import { fetchSkillHistory } from '@/services/api'
import type { SkillLoadEvent } from '@/types'

export function isSkillLoadEvent(value: unknown): value is SkillLoadEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as SkillLoadEvent
  return typeof event.id === 'string' && !!event.id
    && typeof event.skill_name === 'string' && !!event.skill_name
    && typeof event.loaded_at === 'string' && Number.isFinite(Date.parse(event.loaded_at))
    && ['manual', 'auto', 'recent', 'always', 'read_file'].includes(event.source)
}

function merge(existing: SkillLoadEvent[], incoming: SkillLoadEvent[]) {
  const byId = new Map(existing.map((event) => [event.id, event]))
  for (const event of incoming) if (isSkillLoadEvent(event)) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => Date.parse(a.loaded_at) - Date.parse(b.loaded_at))
}

interface SkillHistoryState {
  events: Record<string, SkillLoadEvent[]>
  liveIds: Record<string, string[]>
  cursors: Record<string, number | null>
  loading: Record<string, boolean>
  errors: Record<string, string | null>
  ingest: (sessionId: string, event: unknown) => void
  load: (sessionId: string, older?: boolean) => Promise<void>
  reset: () => void
}

let epoch = 0
let requests: Record<string, number> = {}

export const useSkillHistoryStore = create<SkillHistoryState>((set, get) => ({
  events: {}, liveIds: {}, cursors: {}, loading: {}, errors: {},
  ingest: (sessionId, event) => {
    if (!isSkillLoadEvent(event)) return
    set((state) => {
      if (state.events[sessionId]?.some((item) => item.id === event.id)) return state
      return {
        events: { ...state.events, [sessionId]: merge(state.events[sessionId] ?? [], [event]) },
        liveIds: { ...state.liveIds, [sessionId]: [...(state.liveIds[sessionId] ?? []), event.id].slice(-500) },
      }
    })
  },
  load: async (sessionId, older = false) => {
    const cursor = older ? get().cursors[sessionId] : undefined
    if (older && cursor == null) return
    const startedEpoch = epoch
    const request = (requests[sessionId] ?? 0) + 1
    requests[sessionId] = request
    set((state) => ({ loading: { ...state.loading, [sessionId]: true }, errors: { ...state.errors, [sessionId]: null } }))
    try {
      const page = await fetchSkillHistory(sessionId, cursor ?? undefined)
      if (epoch !== startedEpoch || requests[sessionId] !== request) return
      set((state) => ({
        events: { ...state.events, [sessionId]: merge(state.events[sessionId] ?? [], Array.isArray(page.events) ? page.events : []) },
        // Re-page on reconnect: more than one page may have arrived while offline.
        // Previously fetched rows are deduplicated, not discarded.
        cursors: { ...state.cursors, [sessionId]: page.next_cursor },
        loading: { ...state.loading, [sessionId]: false },
      }))
    } catch (error) {
      if (epoch !== startedEpoch || requests[sessionId] !== request) return
      set((state) => ({ loading: { ...state.loading, [sessionId]: false }, errors: { ...state.errors, [sessionId]: error instanceof Error ? error.message : 'unavailable' } }))
    }
  },
  reset: () => {
    epoch += 1
    requests = {}
    set({ events: {}, liveIds: {}, cursors: {}, loading: {}, errors: {} })
  },
}))
