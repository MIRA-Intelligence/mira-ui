import { useEffect } from 'react'
import { wsClient } from '@/services/websocket'
import { bootstrapLocalEngine, getBootstrapState, hasDesktopEngineManager, setEngineModeHint } from '@/services/desktop'
import type { LocalEngineBootstrapState } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import { fetchRuntimeConfig } from '@/services/runtimeConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useUiStore } from '@/stores/uiStore'
import { resolveApiUrl, resolveWsUrl } from '@/lib/gatewayEndpoints'
import { t } from '@/i18n'

async function syncOnConnect() {
  const {
    workspacePath,
    apiUrl,
    setRuntimeConfig,
    setRuntimeConfigLoaded,
    setRuntimeConfigError,
    setWorkspacePath,
  } = useSettingsStore.getState()
  try {
    const payload = await fetchRuntimeConfig(apiUrl)
    const nextWorkspacePath = payload.runtime.workspace || payload.projects_root
    if (workspacePath.trim() !== nextWorkspacePath.trim()) {
      useAgentStore.getState().resetWorkspaceState()
      useProjectStore.getState().resetWorkspaceState()
    }
    // Load the Quick Chat thread index for this workspace (no-op if already
    // loaded for the same workspace, preserving the active chat on reconnect).
    useChatStore.getState().loadForWorkspace(nextWorkspacePath.trim())
    setRuntimeConfig(payload)
    setRuntimeConfigLoaded(true)
    setRuntimeConfigError(null)
    setWorkspacePath(nextWorkspacePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setRuntimeConfigError(message)
    setRuntimeConfigLoaded(false)
  }

  await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
}

export function useWebSocket() {
  const handleWsMessage = useAgentStore((s) => s.handleWsMessage)
  const setConnected = useAgentStore((s) => s.setConnected)
  const setEngineBootstrap = useSettingsStore((s) => s.setEngineBootstrap)
  const setConnectionMessage = useSettingsStore((s) => s.setConnectionMessage)
  const setLocalEngineBootstrap = useSettingsStore((s) => s.setLocalEngineBootstrap)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const wsUrl = useSettingsStore((s) => s.wsUrl)
  const engineStatus = useSettingsStore((s) => s.engineStatus)

  // Mirror the active deployment mode to the main process so the next app
  // launch can pre-warm (or skip) the local engine based on what the user
  // last used. Runs on mount (seeding the persisted hint) and on every toggle.
  useEffect(() => {
    void setEngineModeHint(deploymentMode)
  }, [deploymentMode])

  useEffect(() => {
    let disposed = false
    let bootstrapPoll: ReturnType<typeof setInterval> | null = null

    const clearBootstrapPoll = () => {
      if (bootstrapPoll) {
        clearInterval(bootstrapPoll)
        bootstrapPoll = null
      }
    }

    const applyLocalState = (localState: LocalEngineBootstrapState) => {
      setLocalEngineBootstrap({
        phase: localState.phase,
        message: localState.message,
        executablePath: localState.executablePath,
        version: localState.version,
        operation: localState.operation,
      })
    }

    const bootstrap = async () => {
      try {
        setConnectionMessage(null)
        const lang = useSettingsStore.getState().language
        const localBundle = deploymentMode === 'localBundle'
        const safeApiUrl = resolveApiUrl(useSettingsStore.getState())

        if (localBundle) {
          if (!hasDesktopEngineManager()) {
            setLocalEngineBootstrap({
              phase: 'error',
              message: t('localBundleDesktopRequired', lang),
            })
            setEngineBootstrap({
              status: 'unreachable',
              message: t('localBundleDesktopRequired', lang),
              version: null,
            })
            setConnectionMessage(t('localBundleDesktopBridgeUnavailable', lang))
            setConnected(false)
            return
          }

          setLocalEngineBootstrap({
            phase: 'checking',
            message: t('localBundleBootstrapping', lang),
            executablePath: null,
            version: null,
            operation: 'bootstrap',
          })
          const bootstrapPromise = bootstrapLocalEngine()
          bootstrapPoll = setInterval(() => {
            void getBootstrapState().then((snapshot) => {
              if (!disposed && snapshot) applyLocalState(snapshot)
            })
          }, 500)
          const localState = await bootstrapPromise
          clearBootstrapPoll()
          if (!localState || disposed) return
          applyLocalState(localState)
          if (localState.phase !== 'ready') {
            setEngineBootstrap({
              status: 'unreachable',
              message: localState.message,
              version: localState.version,
            })
            setConnectionMessage(localState.message)
            setConnected(false)
            return
          }
        }

        const probe = await probeEngineCompatibility(safeApiUrl)
        if (disposed) return

        setEngineBootstrap({
          status: probe.status,
          message: probe.status === 'compatible' ? null : probe.message,
          version: probe.version,
          uptimeSeconds: probe.uptimeSeconds,
        })

        if (probe.status !== 'compatible') {
          setConnectionMessage(probe.message)
          setConnected(false)
          return
        }
      } catch (error) {
        clearBootstrapPoll()
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        const lang = useSettingsStore.getState().language
        setEngineBootstrap({
          status: 'unreachable',
          message: t('uiBootstrapFailed', lang, { message }),
          version: null,
        })
        setConnectionMessage(t('uiBootstrapFailed', lang, { message }))
        setConnected(false)
      }
    }

    bootstrap()

    return () => {
      disposed = true
      clearBootstrapPoll()
    }
  }, [apiUrl, deploymentMode, setConnected, setConnectionMessage, setEngineBootstrap, setLocalEngineBootstrap])

  useEffect(() => {
    const safeWsUrl = resolveWsUrl(useSettingsStore.getState())

    if (!safeWsUrl || !safeWsUrl.trim()) {
      const lang = useSettingsStore.getState().language
      setEngineBootstrap({
        status: 'unreachable',
        message: t('wsUrlEmpty', lang),
        version: null,
      })
      setConnectionMessage(t('wsUrlEmptyDetail', lang))
      setConnected(false)
      wsClient.disconnect()
      return
    }

    if (engineStatus !== 'compatible') {
      const nextMessage = useSettingsStore.getState().engineMessage
      if (nextMessage) setConnectionMessage(nextMessage)
      setConnected(false)
      wsClient.disconnect()
      return
    }

    const unsubMsg = wsClient.onMessage(handleWsMessage)
    const unsubStatus = wsClient.onStatus((connected, detail) => {
      const prevConnected = useAgentStore.getState().connected
      if (prevConnected !== connected) {
        setConnected(connected)
        const lang = useSettingsStore.getState().language
        const pushSystemMessage = useUiStore.getState().pushSystemMessage
        if (connected) {
          pushSystemMessage(t('sysMsgEngineConnected', lang), { severity: 'success', ttlMs: 3000 })
        } else if (prevConnected) {
          pushSystemMessage(t('sysMsgEngineDisconnected', lang), { severity: 'warning', ttlMs: 5000 })
        }
      }
      if (connected) {
        setConnectionMessage(null)
        void syncOnConnect()
      } else if (detail) {
        setConnectionMessage(detail)
      }
    })
    wsClient.connect()

    return () => {
      unsubMsg()
      unsubStatus()
      wsClient.disconnect()
    }
  }, [deploymentMode, engineStatus, handleWsMessage, setConnected, setConnectionMessage, setEngineBootstrap, wsUrl])
}
