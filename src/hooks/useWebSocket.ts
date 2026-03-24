import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'

async function pushProjectsRoot() {
  const { workspacePath, apiUrl } = useSettingsStore.getState()
  try {
    await fetch(`${apiUrl}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects_root: workspacePath }),
    })
  } catch { /* gateway may be unreachable */ }
}

export function useWebSocket() {
  const { handleWsMessage, setConnected } = useAgentStore()

  useEffect(() => {
    wsClient.connect()

    const unsubMsg = wsClient.onMessage(handleWsMessage)
    const unsubStatus = wsClient.onStatus((connected) => {
      setConnected(connected)
      if (connected) {
        pushProjectsRoot()
      }
    })

    return () => {
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [handleWsMessage, setConnected])
}
