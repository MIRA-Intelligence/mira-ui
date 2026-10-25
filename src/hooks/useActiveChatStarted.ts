import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'

/**
 * Whether the selected Quick Chat has begun: it has a message, or a title
 * (set from the first message, or by a rename). False with no chat selected.
 */
export function useActiveChatStarted(): boolean {
  const activeChatId = useChatStore((s) => s.activeChatId)
  const titled = useChatStore((s) => Boolean(s.chats.find((chat) => chat.id === s.activeChatId)?.title))
  const hasLogs = useAgentStore((s) => Boolean(activeChatId && s.logsByProject[activeChatId]?.length))
  return Boolean(activeChatId) && (titled || hasLogs)
}
