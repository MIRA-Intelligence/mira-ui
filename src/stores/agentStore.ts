import { create } from 'zustand'
import type { LogEntry, WsResponse } from '@/types'
import { useProjectStore } from '@/stores/projectStore'

interface AgentState {
  logsByProject: Record<string, LogEntry[]>
  isStreaming: boolean
  connected: boolean

  addLog: (projectId: string, entry: LogEntry) => void
  handleWsMessage: (msg: WsResponse) => void
  setConnected: (v: boolean) => void
  clearLogs: (projectId: string) => void
  getProjectLogs: (projectId: string | null) => LogEntry[]
}

let logIdCounter = 0

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

    if (msg.type === 'response') {
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
