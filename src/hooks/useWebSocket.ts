import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { probeEngineCompatibility } from '@/services/engine'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'

async function syncOnConnect() {
  const { workspacePath, apiUrl } = useSettingsStore.getState()
  try {
    await fetch(`${apiUrl}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects_root: workspacePath }),
    })
  } catch { /* gateway may be unreachable */ }

  await useProjectStore.getState().loadProjects()
}

export function useWebSocket() {
  const { handleWsMessage, setConnected } = useAgentStore()
  const setEngineBootstrap = useSettingsStore((s) => s.setEngineBootstrap)

  useEffect(() => {
    let disposed = false
    let unsubMsg = () => {}
    let unsubStatus = () => {}

    const bootstrap = async () => {
      const { apiUrl } = useSettingsStore.getState()
      const probe = await probeEngineCompatibility(apiUrl)
      if (disposed) return

      setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
      })

      if (probe.status !== 'compatible') {
        setConnected(false)
        return
      }

      wsClient.connect()
      unsubMsg = wsClient.onMessage(handleWsMessage)
      unsubStatus = wsClient.onStatus((connected) => {
        setConnected(connected)
        if (connected) {
          syncOnConnect()
        }
      })
    }

    bootstrap()

    return () => {
      disposed = true
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [handleWsMessage, setConnected, setEngineBootstrap])
}
