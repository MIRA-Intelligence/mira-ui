import { create } from 'zustand'
import type { LogEntry, WsResponse } from '@/types'
import { useProjectStore } from '@/stores/projectStore'

interface AgentState {
  logs: LogEntry[]
  isStreaming: boolean
  connected: boolean

  addLog: (entry: LogEntry) => void
  handleWsMessage: (msg: WsResponse) => void
  setConnected: (v: boolean) => void
  clearLogs: () => void
}

let logIdCounter = 0

export const useAgentStore = create<AgentState>((set) => ({
  logs: [],
  isStreaming: false,
  connected: false,

  addLog: (entry) =>
    set((state) => ({ logs: [...state.logs, entry] })),

  handleWsMessage: (msg) => {
    const entry: LogEntry = {
      id: `log-${++logIdCounter}`,
      timestamp: new Date().toISOString(),
      content: msg.content,
      type: msg.type,
      metadata: msg.metadata,
    }

    set((state) => ({
      logs: [...state.logs, entry],
      isStreaming: msg.type === 'progress',
    }))

    // After each final response, refresh the plan from backend
    if (msg.type === 'response') {
      useProjectStore.getState().refreshPlan()
    }
  },

  setConnected: (connected) => set({ connected }),

  clearLogs: () => set({ logs: [], isStreaming: false }),
}))
