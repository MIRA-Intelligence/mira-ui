import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'

export function useWebSocket() {
  const { handleWsMessage, setConnected } = useAgentStore()

  useEffect(() => {
    wsClient.connect()

    const unsubMsg = wsClient.onMessage(handleWsMessage)
    const unsubStatus = wsClient.onStatus((connected) => {
      setConnected(connected)
    })

    return () => {
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [handleWsMessage, setConnected])
}
