import { create } from 'zustand'
import type { LogEntry, WsResponse } from '@/types'
import { NORMAL_CHAT_SESSION_ID } from '@/lib/sessions'
import { useProjectStore } from '@/stores/projectStore'

export interface SessionUsage {
  tokensUsed: number
  maxTokens: number | null
  updatedAt: number
}

interface AgentState {
  logsByProject: Record<string, LogEntry[]>
  isStreaming: boolean
  connected: boolean
  // Cumulative token usage broadcast by the engine via message metadata.
  // Indexed by session id (which the renderer treats as the project id).
  usageBySession: Record<string, SessionUsage>

  addLog: (projectId: string, entry: LogEntry) => void
  hydrateLogs: (projectId: string, entries: LogEntry[]) => void
  handleWsMessage: (msg: WsResponse) => void
  setConnected: (v: boolean) => void
  clearLogs: (projectId: string) => void
  resetWorkspaceState: () => void
  getProjectLogs: (projectId: string | null) => LogEntry[]
  getSessionUsage: (sessionId: string | null) => SessionUsage | null
  resetSessionUsage: (sessionId: string) => void
}

function readUsageFromMetadata(meta: Record<string, unknown> | undefined):
  | { tokensUsed: number; maxTokens: number | null }
  | null {
  if (!meta) return null
  const raw = meta['tokens_used_session']
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  const tokensUsed = Math.floor(raw)
  const maxRaw = meta['max_tokens']
  const maxTokens =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : null
  return { tokensUsed, maxTokens }
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
  if (sessionId === NORMAL_CHAT_SESSION_ID) return
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
  if (sessionId === NORMAL_CHAT_SESSION_ID) return
  clearResponseRefreshTimers(sessionId)
  _responseRefreshTimers[sessionId] = PLAN_RESPONSE_REFRESH_DELAYS.map((delayMs) => setTimeout(() => {
    void useProjectStore.getState().refreshPlan(sessionId)
  }, delayMs))
}

export const useAgentStore = create<AgentState>((set, get) => ({
  logsByProject: {},
  isStreaming: false,
  connected: false,
  usageBySession: {},

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

    const usageUpdate = readUsageFromMetadata(msg.metadata)

    set((state) => {
      const next: Partial<AgentState> = {
        logsByProject: {
          ...state.logsByProject,
          [sessionId]: [...(state.logsByProject[sessionId] ?? []), entry],
        },
        isStreaming: msg.type === 'progress',
      }
      if (usageUpdate) {
        const prev = state.usageBySession[sessionId]
        // Token totals only ever go up within a session; ignore stale or
        // out-of-order broadcasts that would make the chip flicker backwards.
        if (!prev || usageUpdate.tokensUsed >= prev.tokensUsed) {
          next.usageBySession = {
            ...state.usageBySession,
            [sessionId]: {
              tokensUsed: usageUpdate.tokensUsed,
              maxTokens: usageUpdate.maxTokens,
              updatedAt: Date.now(),
            },
          }
        } else if (
          prev.maxTokens !== usageUpdate.maxTokens &&
          usageUpdate.maxTokens !== null
        ) {
          // Budget changed mid-session (e.g. user edited the policy);
          // reflect the new ceiling without rewinding the cumulative count.
          next.usageBySession = {
            ...state.usageBySession,
            [sessionId]: {
              ...prev,
              maxTokens: usageUpdate.maxTokens,
              updatedAt: Date.now(),
            },
          }
        }
      }
      return next as AgentState
    })

    if (msg.type === 'progress') {
      clearResponseRefreshTimers(sessionId)
      ensurePlanPolling(sessionId)
    } else if (msg.type === 'response') {
      stopPlanPolling(sessionId)
      if (sessionId !== NORMAL_CHAT_SESSION_ID) {
        void useProjectStore.getState().refreshPlan(sessionId)
        scheduleResponseRefreshes(sessionId)
      }
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
      const usage = { ...state.usageBySession }
      delete usage[projectId]
      return { logsByProject: updated, isStreaming: false, usageBySession: usage }
    }),

  resetWorkspaceState: () => {
    for (const sessionId of Object.keys(_pollTimers)) {
      stopPlanPolling(sessionId)
    }
    for (const sessionId of Object.keys(_responseRefreshTimers)) {
      clearResponseRefreshTimers(sessionId)
    }
    set({
      logsByProject: {},
      isStreaming: false,
      usageBySession: {},
    })
  },

  getProjectLogs: (projectId) => {
    if (!projectId) return []
    return get().logsByProject[projectId] ?? []
  },

  getSessionUsage: (sessionId) => {
    if (!sessionId) return null
    return get().usageBySession[sessionId] ?? null
  },

  resetSessionUsage: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.usageBySession)) return state
      const next = { ...state.usageBySession }
      delete next[sessionId]
      return { usageBySession: next }
    }),
}))
