import { create } from 'zustand'
import type { LogEntry, WsResponse } from '@/types'
import { isProjectSessionId } from '@/lib/sessions'
import { useProjectStore } from '@/stores/projectStore'

export interface SessionUsage {
  tokensUsed: number
  maxTokens: number | null
  updatedAt: number
}

interface AgentState {
  logsByProject: Record<string, LogEntry[]>
  // Per-session streaming flag. The engine multiplexes many sessions over one
  // socket, so a single global flag leaks one session's activity into every
  // panel (e.g. a brand-new chat showing "mira is thinking"). Keyed by session.
  streamingBySession: Record<string, boolean>
  connected: boolean
  // Cumulative token usage broadcast by the engine via message metadata.
  // Indexed by session id (which the renderer treats as the project id).
  usageBySession: Record<string, SessionUsage>

  addLog: (projectId: string, entry: LogEntry) => void
  hydrateLogs: (projectId: string, entries: LogEntry[]) => void
  handleWsMessage: (msg: WsResponse) => void
  markSessionPending: (sessionId: string) => void
  markSessionIdle: (sessionId: string) => void
  isSessionStreaming: (sessionId: string | null) => boolean
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
  // Plans only exist for research projects; chat threads have no task_plan.
  if (!isProjectSessionId(sessionId)) return
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
  if (!isProjectSessionId(sessionId)) return
  clearResponseRefreshTimers(sessionId)
  _responseRefreshTimers[sessionId] = PLAN_RESPONSE_REFRESH_DELAYS.map((delayMs) => setTimeout(() => {
    void useProjectStore.getState().refreshPlan(sessionId)
  }, delayMs))
}

function setSessionStreaming(
  map: Record<string, boolean>,
  sessionId: string,
  streaming: boolean,
): Record<string, boolean> {
  const current = map[sessionId] ?? false
  if (current === streaming) return map
  if (!streaming) {
    if (!(sessionId in map)) return map
    const next = { ...map }
    delete next[sessionId]
    return next
  }
  return { ...map, [sessionId]: true }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  logsByProject: {},
  streamingBySession: {},
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

    // Live token streaming: grow a single assistant entry as deltas arrive,
    // then finalize it on stream end. No final `response` is sent while
    // streaming, so this entry is the canonical message until reload.
    if (msg.type === 'stream_delta') {
      if (!msg.content) return
      set((state) => {
        const list = state.logsByProject[sessionId] ?? []
        const last = list[list.length - 1]
        let nextList: LogEntry[]
        if (last && last.type === 'response' && last.metadata?._streaming) {
          nextList = [...list.slice(0, -1), { ...last, content: last.content + msg.content }]
        } else {
          nextList = [
            ...list,
            {
              id: `log-${++logIdCounter}`,
              timestamp: new Date().toISOString(),
              content: msg.content,
              type: 'response',
              metadata: { _streaming: true },
            },
          ]
        }
        return {
          logsByProject: { ...state.logsByProject, [sessionId]: nextList },
          streamingBySession: setSessionStreaming(state.streamingBySession, sessionId, true),
        }
      })
      return
    }

    if (msg.type === 'stream_end') {
      set((state) => {
        const list = state.logsByProject[sessionId]
        let nextLogs = state.logsByProject
        if (list && list.some((e) => e.metadata?._streaming)) {
          nextLogs = {
            ...state.logsByProject,
            [sessionId]: list.map((e) => {
              if (!e.metadata?._streaming) return e
              const meta = { ...e.metadata }
              delete meta._streaming
              return { ...e, metadata: meta }
            }),
          }
        }
        return {
          logsByProject: nextLogs,
          streamingBySession: setSessionStreaming(state.streamingBySession, sessionId, false),
        }
      })
      return
    }

    const statusOnly = msg.metadata?._activity_ping === true
    const entry: LogEntry = {
      id: `log-${++logIdCounter}`,
      timestamp: new Date().toISOString(),
      content: msg.content,
      type: msg.type,
      metadata: msg.metadata,
    }

    const usageUpdate = readUsageFromMetadata(msg.metadata)

    set((state) => {
      const streaming = msg.type === 'progress' || msg.type === 'tool_call'
      const next: Partial<AgentState> = {
        streamingBySession: setSessionStreaming(state.streamingBySession, sessionId, streaming),
      }
      if (!statusOnly) {
        next.logsByProject = {
          ...state.logsByProject,
          [sessionId]: [...(state.logsByProject[sessionId] ?? []), entry],
        }
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

    if (msg.type === 'progress' || msg.type === 'tool_call') {
      clearResponseRefreshTimers(sessionId)
      ensurePlanPolling(sessionId)
    } else if (msg.type === 'response') {
      stopPlanPolling(sessionId)
      if (isProjectSessionId(sessionId)) {
        void useProjectStore.getState().refreshPlan(sessionId)
        scheduleResponseRefreshes(sessionId)
      }
    }
  },

  markSessionPending: (sessionId) =>
    set((state) => {
      const next = setSessionStreaming(state.streamingBySession, sessionId, true)
      return next === state.streamingBySession ? state : { streamingBySession: next }
    }),

  markSessionIdle: (sessionId) =>
    set((state) => {
      const next = setSessionStreaming(state.streamingBySession, sessionId, false)
      return next === state.streamingBySession ? state : { streamingBySession: next }
    }),

  isSessionStreaming: (sessionId) => {
    if (!sessionId) return false
    return get().streamingBySession[sessionId] ?? false
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
      return {
        logsByProject: updated,
        streamingBySession: setSessionStreaming(state.streamingBySession, projectId, false),
        usageBySession: usage,
      }
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
      streamingBySession: {},
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
