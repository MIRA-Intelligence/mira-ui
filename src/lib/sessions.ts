// Legacy single shared quick-chat session id. Kept only so old engine session
// logs keyed `ui:__normal__` still resolve; new chats use per-thread ids.
export const NORMAL_CHAT_SESSION_ID = '__normal__'

const CHAT_SESSION_PREFIX = 'chat-'
const PROJECT_SESSION_PREFIX = 'PRJ'

/** Generate a fresh, per-thread Quick Chat session id (basic loop). */
export function newChatSessionId(): string {
  return `${CHAT_SESSION_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** True for lightweight chat threads (basic loop), including the legacy id. */
export function isChatSessionId(id: string | null | undefined): boolean {
  return typeof id === 'string'
    && (id.startsWith(CHAT_SESSION_PREFIX) || id === NORMAL_CHAT_SESSION_ID)
}

/** True for research-project sessions (research loop, plan-backed). */
export function isProjectSessionId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(PROJECT_SESSION_PREFIX)
}
