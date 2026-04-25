import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { bootstrapLocalEngine, hasDesktopEngineManager } from '@/services/desktop'
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
  const handleWsMessage = useAgentStore((s) => s.handleWsMessage)
  const setConnected = useAgentStore((s) => s.setConnected)
  const setEngineBootstrap = useSettingsStore((s) => s.setEngineBootstrap)
  const setLocalEngineBootstrap = useSettingsStore((s) => s.setLocalEngineBootstrap)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const wsUrl = useSettingsStore((s) => s.wsUrl)

  useEffect(() => {
    let disposed = false
    let unsubMsg = () => {}
    let unsubStatus = () => {}

    const bootstrap = async () => {
      try {
        const localBundle = deploymentMode === 'localBundle'
        const safeApiUrl = localBundle
          ? 'http://127.0.0.1:18790/api'
          : (typeof apiUrl === 'string' ? apiUrl : 'http://127.0.0.1:18790/api')
        const safeWsUrl = localBundle ? 'ws://127.0.0.1:18790/ws' : wsUrl

        if (localBundle) {
          if (!hasDesktopEngineManager()) {
            setLocalEngineBootstrap({
              phase: 'error',
              message: 'Local bundle mode requires the MIRA desktop app. Switch to remote mode in browser builds.',
            })
            setEngineBootstrap({
              status: 'unreachable',
              message: 'Local bundle mode requires the MIRA desktop app. Switch to remote mode in browser builds.',
              version: null,
            })
            setConnected(false)
            return
          }

          setLocalEngineBootstrap({
            phase: 'checking',
            message: 'Bootstrapping bundled local engine...',
            executablePath: null,
            version: null,
          })
          const localState = await bootstrapLocalEngine()
          if (!localState || disposed) return
          setLocalEngineBootstrap({
            phase: localState.phase,
            message: localState.message,
            executablePath: localState.executablePath,
            version: localState.version,
          })
          if (localState.phase !== 'ready') {
            setEngineBootstrap({
              status: 'unreachable',
              message: localState.message,
              version: localState.version,
            })
            setConnected(false)
            return
          }
        }

        if (!safeWsUrl || !safeWsUrl.trim()) {
          setEngineBootstrap({
            status: 'unreachable',
            message: 'WebSocket URL is empty. Update wsUrl in settings and retry.',
            version: null,
          })
          setConnected(false)
          return
        }
        const probe = await probeEngineCompatibility(safeApiUrl)
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

        unsubMsg = wsClient.onMessage(handleWsMessage)
        unsubStatus = wsClient.onStatus((connected) => {
          if (useAgentStore.getState().connected !== connected) {
            setConnected(connected)
          }
          if (connected) {
            void syncOnConnect()
          }
        })
        wsClient.connect()
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setEngineBootstrap({
          status: 'unreachable',
          message: `UI bootstrap failed: ${message}`,
          version: null,
        })
        setConnected(false)
      }
    }

    bootstrap()

    return () => {
      disposed = true
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [apiUrl, deploymentMode, wsUrl, handleWsMessage, setConnected, setEngineBootstrap, setLocalEngineBootstrap])
}
