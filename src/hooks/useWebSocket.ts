import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'

export function useWebSocket() {
  const { handleWsMessage, setConnected } = useAgentStore()

  useEffect(() => {
    wsClient.connect()

    const unsubMsg = wsClient.onMessage(handleWsMessage)
    const unsubStatus = wsClient.onStatus((connected) => {
      setConnected(connected)
      if (connected) {
        useProjectStore.getState().refreshPlan()
      }
    })

    return () => {
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [handleWsMessage, setConnected])
}
