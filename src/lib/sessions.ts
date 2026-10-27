import { createUuid } from './uuid'

// Legacy single shared quick-chat session id. Kept only so old engine session
// logs keyed `ui:__normal__` still resolve; new chats use per-thread ids.
export const NORMAL_CHAT_SESSION_ID = '__normal__'

// The reserved Quick Chat the agent's background community work lands in
// (the engine's `COMMUNITY_CHAT_ID`). It is pinned in the sidebar once the user
// has joined the community; it is never in the chat index, a folder or a batch.
export const COMMUNITY_CHAT_SESSION_ID = 'community'

const CHAT_SESSION_PREFIX = 'chat-'
const PROJECT_SESSION_PREFIX = 'PRJ'

/** Generate a fresh, per-thread Quick Chat session id (basic loop). */
export function newChatSessionId(): string {
  return `${CHAT_SESSION_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Generate a lightweight project shell id before the user starts any module. */
export function newProjectSessionId(): string {
  return `${PROJECT_SESSION_PREFIX}-${Date.now().toString(36)}-${createUuid().slice(0, 8)}`
}

/** True for the chat the agent owns (not renamable, deletable or movable). */
export function isReservedChatId(id: string | null | undefined): boolean {
  return id === COMMUNITY_CHAT_SESSION_ID
}

/** True for lightweight chat threads (basic loop), including the legacy id. */
export function isChatSessionId(id: string | null | undefined): boolean {
  return typeof id === 'string'
    && (id.startsWith(CHAT_SESSION_PREFIX) || id === NORMAL_CHAT_SESSION_ID || isReservedChatId(id))
}

/** True for research-project sessions (research loop, plan-backed). */
export function isProjectSessionId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(PROJECT_SESSION_PREFIX)
}
