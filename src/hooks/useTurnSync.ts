import { useEffect } from 'react'
import { fetchActiveTurns } from '@/services/api'
import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'

export const TURN_SYNC_INTERVAL_MS = 30_000

/** Sessions worth asking about: every one shown as working, plus the open one. */
function sessionsToSync(): string[] {
  const { streamingBySession } = useAgentStore.getState()
  const ids = new Set(
    Object.keys(streamingBySession)
      .filter((key) => streamingBySession[key])
      .map((key) => key.split(':run:')[0]),
  )
  const { appMode, selectedTaskId } = useProjectStore.getState()
  const open = appMode === 'normal' ? useChatStore.getState().activeChatId : selectedTaskId
  if (open) ids.add(open)
  return [...ids]
}

export async function syncTurns(sessionIds: string[] = sessionsToSync()): Promise<void> {
  await Promise.all(sessionIds.map(async (sessionId) => {
    const active = await fetchActiveTurns(sessionId)
    if (active) useAgentStore.getState().syncActiveTurns(sessionId, active)
  }))
}

/**
 * Keeps "thinking" honest against the engine's own record of running turns:
 * on every (re)connect, and periodically while any session looks busy, so a
 * missed turn_finished (dropped socket, engine restart) cannot spin forever.
 */
export function useTurnSync() {
  const connected = useAgentStore((s) => s.connected)

  useEffect(() => {
    if (!connected) return
    void syncTurns()
    const timer = setInterval(() => {
      const { streamingBySession } = useAgentStore.getState()
      if (Object.values(streamingBySession).some(Boolean)) void syncTurns()
    }, TURN_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [connected])
}
