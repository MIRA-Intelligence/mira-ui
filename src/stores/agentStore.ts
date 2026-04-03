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
const _pollTimers: Record<string, ReturnType<typeof setInterval>> = {}

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
      if (entries.length === 0 || (state.logsByProject[projectId]?.length ?? 0) > 0) {
        return state
      }
      return {
        logsByProject: {
          ...state.logsByProject,
          [projectId]: entries,
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
      ensurePlanPolling(sessionId)
    } else if (msg.type === 'response') {
      stopPlanPolling(sessionId)
      useProjectStore.getState().refreshPlan(sessionId)
    }
  },

  setConnected: (connected) => set({ connected }),

  clearLogs: (projectId) =>
    set((state) => {
      const updated = { ...state.logsByProject }
      delete updated[projectId]
      return { logsByProject: updated, isStreaming: false }
    }),

  getProjectLogs: (projectId) => {
    if (!projectId) return []
    return get().logsByProject[projectId] ?? []
  },
}))
