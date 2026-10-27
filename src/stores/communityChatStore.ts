import { useMemo } from 'react'
import { create } from 'zustand'
import type { LogEntry } from '@/types'
import { useAgentStore } from '@/stores/agentStore'

/**
 * What the user has seen of the reserved Mira Community chat (see
 * `useCommunityChat`). The agent writes there on its own — heartbeat turns
 * report what it did in the community — so the sidebar shows how many of its
 * messages arrived since the user last looked. Kept per workspace in
 * localStorage, like the chat index.
 */
const STORAGE_PREFIX = 'mira.communityChat.lastSeen:'

interface CommunityChatState {
  workspaceKey: string
  /** Epoch ms of the newest agent message the user has seen; 0 = never looked. */
  lastSeenAt: number

  loadForWorkspace: (workspaceKey: string) => void
  /** The user has seen everything up to this time; earlier marks are kept. */
  markSeen: (at: number) => void
}

function readLastSeen(workspaceKey: string): number {
  try {
    const parsed = Number(localStorage.getItem(STORAGE_PREFIX + workspaceKey) ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

function writeLastSeen(workspaceKey: string, at: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + workspaceKey, String(at))
  } catch {
    // Ignore unavailable / quota-exceeded storage.
  }
}

export const useCommunityChatStore = create<CommunityChatState>((set, get) => ({
  workspaceKey: '',
  lastSeenAt: 0,

  loadForWorkspace: (workspaceKey) => {
    if (get().workspaceKey === workspaceKey) return
    set({ workspaceKey, lastSeenAt: readLastSeen(workspaceKey) })
  },

  markSeen: (at) => {
    const { workspaceKey, lastSeenAt } = get()
    if (!(at > lastSeenAt)) return
    if (workspaceKey) writeLastSeen(workspaceKey, at)
    set({ lastSeenAt: at })
  },
}))

/** A message the agent wrote: not the user's own, not a progress or tool line. */
export function isAgentMessage(entry: LogEntry): boolean {
  return entry.type === 'response' && !entry.metadata?._user
}

function entryTime(entry: LogEntry): number {
  const time = Date.parse(entry.timestamp)
  return Number.isFinite(time) ? time : 0
}

export function newestAgentMessageAt(logs: LogEntry[] | undefined): number {
  let newest = 0
  for (const entry of logs ?? []) {
    if (isAgentMessage(entry)) newest = Math.max(newest, entryTime(entry))
  }
  return newest
}

export function countUnread(logs: LogEntry[] | undefined, lastSeenAt: number): number {
  let count = 0
  for (const entry of logs ?? []) {
    if (isAgentMessage(entry) && entryTime(entry) > lastSeenAt) count += 1
  }
  return count
}

/** Agent messages in the community chat the user has not looked at yet. */
export function useCommunityChatUnread(chatId: string | null): number {
  const logs = useAgentStore((s) => (chatId ? s.logsByProject[chatId] : undefined))
  const lastSeenAt = useCommunityChatStore((s) => s.lastSeenAt)
  return useMemo(() => countUnread(logs, lastSeenAt), [logs, lastSeenAt])
}
