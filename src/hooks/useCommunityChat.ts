import { useEffect } from 'react'
import { fetchSessionHistory } from '@/services/api'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'
import { newestAgentMessageAt, useCommunityChatStore } from '@/stores/communityChatStore'
import { selectCommunityChatId, useCommunityStore } from '@/stores/communityStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Keeps the reserved Mira Community chat live while the user is elsewhere.
 *
 * The engine pushes a chat's messages only to a socket bound to it, and the
 * conversation pane binds the open chat alone. The agent writes to this chat
 * on its own (its heartbeat turns run there), so on every connect — and as
 * soon as the user has joined — it is bound as well and its history fetched;
 * the unread count in the sidebar is computed from that. While the chat is
 * open, whatever arrives counts as seen.
 */
export function useCommunityChat(): void {
  const connected = useAgentStore((s) => s.connected)
  const chatId = useCommunityStore(selectCommunityChatId)
  const workspaceKey = useChatStore((s) => s.workspaceKey)
  const appMode = useProjectStore((s) => s.appMode)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const logs = useAgentStore((s) => (chatId ? s.logsByProject[chatId] : undefined))
  const viewing = Boolean(chatId) && appMode === 'normal' && activeChatId === chatId

  useEffect(() => {
    useCommunityChatStore.getState().loadForWorkspace(workspaceKey)
  }, [workspaceKey])

  // Membership is read on every connect: the engine may come up after the
  // app, and the pinned chat should not wait for the next periodic refresh.
  useEffect(() => {
    if (connected) void useCommunityStore.getState().refresh()
  }, [connected])

  useEffect(() => {
    if (!connected || !chatId) return
    wsClient.send({ type: 'bind', content: '', session_id: chatId, user_id: 'ui_user' })
    let cancelled = false
    void fetchSessionHistory(chatId).then((entries) => {
      if (!cancelled && entries.length > 0) useAgentStore.getState().hydrateLogs(chatId, entries)
    })
    return () => {
      cancelled = true
    }
  }, [connected, chatId])

  useEffect(() => {
    if (!viewing) return
    useCommunityChatStore.getState().markSeen(newestAgentMessageAt(logs))
  }, [viewing, logs])
}
