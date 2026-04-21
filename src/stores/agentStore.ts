import { create } from 'zustand'
import type { LogEntry, WsResponse } from '@/types'
import { useProjectStore } from '@/stores/projectStore'

interface AgentState {
  logsByProject: Record<string, LogEntry[]>
  isStreaming: boolean
  connected: boolean

  addLog: (projectId: string, entry: LogEntry) => void
  hydrateLogs: (projectId: string, entries: LogEntry[]) => void
  handleWsMessage: (msg: WsResponse) => void
  setConnected: (v: boolean) => void
  clearLogs: (projectId: string) => void
  getProjectLogs: (projectId: string | null) => LogEntry[]
}

let logIdCounter = 0

const PLAN_POLL_INTERVAL = 3000
const PLAN_RESPONSE_REFRESH_DELAYS = [800, 2200] as const
const _pollTimers: Record<string, ReturnType<typeof setInterval>> = {}
const _responseRefreshTimers: Record<string, ReturnType<typeof setTimeout>[]> = {}

function logDedupKey(entry: LogEntry): string {
  const fromUser = entry.metadata?._user ? 'user' : 'agent'
  const fromAuto = entry.metadata?._auto ? 'auto' : 'manual'
  return `${entry.timestamp}|${entry.type}|${fromUser}|${fromAuto}|${entry.content}`
}

function ensurePlanPolling(sessionId: string) {
  if (_pollTimers[sessionId]) return
  _pollTimers[sessionId] = setInterval(() => {
    useProjectStore.getState().refreshPlan(sessionId)
  }, PLAN_POLL_INTERVAL)
}

function stopPlanPolling(sessionId: string) {
  const timer = _pollTimers[sessionId]
  if (timer) {
    clearInterval(timer)
    delete _pollTimers[sessionId]
  }
}

function clearResponseRefreshTimers(sessionId: string) {
  const timers = _responseRefreshTimers[sessionId]
  if (!timers || timers.length === 0) return
  for (const timer of timers) {
    clearTimeout(timer)
  }
  delete _responseRefreshTimers[sessionId]
}

function scheduleResponseRefreshes(sessionId: string) {
  clearResponseRefreshTimers(sessionId)
  _responseRefreshTimers[sessionId] = PLAN_RESPONSE_REFRESH_DELAYS.map((delayMs) => setTimeout(() => {
    void useProjectStore.getState().refreshPlan(sessionId)
  }, delayMs))
}

export const useAgentStore = create<AgentState>((set, get) => ({
  logsByProject: {},
  isStreaming: false,
  connected: false,

  addLog: (projectId, entry) =>
    set((state) => ({
      logsByProject: {
        ...state.logsByProject,
        [projectId]: [...(state.logsByProject[projectId] ?? []), entry],
      },
    })),

  hydrateLogs: (projectId, entries) =>
    set((state) => {
      if (entries.length === 0) {
        return state
      }
      const existing = state.logsByProject[projectId] ?? []
      if (existing.length === 0) {
        return {
          logsByProject: {
            ...state.logsByProject,
            [projectId]: entries,
          },
        }
      }
      const merged: LogEntry[] = []
      const seen = new Set<string>()
      for (const entry of [...entries, ...existing]) {
        const key = logDedupKey(entry)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(entry)
      }
      if (merged.length === existing.length) {
        return state
      }
      return {
        logsByProject: {
          ...state.logsByProject,
          [projectId]: merged,
        },
      }
    }),

  handleWsMessage: (msg) => {
    const sessionId = msg.session_id ?? '_unknown'
    const entry: LogEntry = {
      id: `log-${++logIdCounter}`,
      timestamp: new Date().toISOString(),
      content: msg.content,
      type: msg.type,
      metadata: msg.metadata,
    }

    set((state) => ({
      logsByProject: {
        ...state.logsByProject,
        [sessionId]: [...(state.logsByProject[sessionId] ?? []), entry],
      },
      isStreaming: msg.type === 'progress',
    }))

    if (msg.type === 'progress') {
      clearResponseRefreshTimers(sessionId)
      ensurePlanPolling(sessionId)
    } else if (msg.type === 'response') {
      stopPlanPolling(sessionId)
      void useProjectStore.getState().refreshPlan(sessionId)
      scheduleResponseRefreshes(sessionId)
    }
  },

  setConnected: (connected) =>
    set((state) => (state.connected === connected ? state : { connected })),

  clearLogs: (projectId) =>
    set((state) => {
      stopPlanPolling(projectId)
      clearResponseRefreshTimers(projectId)
      const updated = { ...state.logsByProject }
      delete updated[projectId]
      return { logsByProject: updated, isStreaming: false }
    }),

  getProjectLogs: (projectId) => {
    if (!projectId) return []
    return get().logsByProject[projectId] ?? []
  },
}))
