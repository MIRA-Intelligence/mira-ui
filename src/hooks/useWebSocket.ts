import { useEffect, useLayoutEffect, useState } from 'react'
import { useSkillHistoryStore } from '@/stores/skillHistoryStore'
import { useTokenUsageStore } from '@/stores/tokenUsageStore'
import { wsClient } from '@/services/websocket'
import { bootstrapLocalEngine, getBootstrapState, hasDesktopEngineManager, setEngineModeHint } from '@/services/desktop'
import type { LocalEngineBootstrapState } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import { fetchRuntimeConfig } from '@/services/runtimeConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useOrganizationStore } from '@/stores/organizationStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import {
  IDLE_REMOTE_SSH_STATUS,
  connectRemoteSsh,
  disconnectRemoteSsh,
  getRemoteSshStatus,
  hasRemoteSshBridge,
  onRemoteSshStatus,
  tunnelEndpoints,
} from '@/services/remoteSsh'
import { forgetRemoteSshToken } from '@/services/engineAuth'
import { useRemoteSshStore } from '@/stores/remoteSshStore'
import { remoteSshMessage } from '@/lib/remoteSshMessages'

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
      useOrganizationStore.getState().reset()
    }
    // Load the Quick Chat thread index for this workspace (no-op if already
    // loaded for the same workspace, preserving the active chat on reconnect).
    useChatStore.getState().loadForWorkspace(nextWorkspacePath.trim())
    const cachedChats = useChatStore.getState().chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      created_at: new Date(chat.createdAt).toISOString(),
      updated_at: new Date(chat.updatedAt).toISOString(),
    }))
    const organization = await useOrganizationStore.getState().load(cachedChats, nextWorkspacePath.trim())
    if (organization) useChatStore.getState().replaceFromRemote(organization.chats)
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
  const sshHost = useSettingsStore((s) => s.sshHost)
  const sshMiraCommand = useSettingsStore((s) => s.sshMiraCommand)
  const engineStatus = useSettingsStore((s) => s.engineStatus)
  // Bumped when a Remote-SSH connection comes back on the same tunnel port, so
  // the engine is probed again even though apiUrl did not change.
  const [sshEpoch, setSshEpoch] = useState(0)

  useLayoutEffect(() => {
    useSkillHistoryStore.getState().reset()
    useTokenUsageStore.getState().reset()
  }, [apiUrl])

  // Mirror the active deployment mode to the main process so the next app
  // launch can pre-warm (or skip) the local engine based on what the user
  // last used. Runs on mount (seeding the persisted hint) and on every toggle.
  useEffect(() => {
    void setEngineModeHint(deploymentMode)
  }, [deploymentMode])

  // Remote-SSH: mirror the main process's connection state, follow tunnel
  // endpoint changes, and drop the connection when leaving the mode/host.
  useEffect(() => {
    const setStatus = useRemoteSshStore.getState().setStatus
    if (deploymentMode !== 'remoteSsh') {
      setStatus(IDLE_REMOTE_SSH_STATUS)
      return
    }
    let active = true
    void getRemoteSshStatus().then((status) => { if (active) setStatus(status) })
    const unsubscribe = onRemoteSshStatus((status) => {
      if (!active) return
      setStatus(status)
      forgetRemoteSshToken()
      const settings = useSettingsStore.getState()
      if (settings.deploymentMode !== 'remoteSsh' || status.host !== settings.sshHost.trim()) return
      const message = remoteSshMessage(status, settings.language, '', settings.sshMiraCommand)
      if (status.phase === 'connected' && status.localPort) {
        const endpoints = tunnelEndpoints(status.localPort)
        if (endpoints.apiUrl !== settings.apiUrl || endpoints.wsUrl !== settings.wsUrl) {
          settings.setConnectionEndpoints(endpoints.apiUrl, endpoints.wsUrl)
        } else if (settings.engineStatus !== 'compatible') {
          setSshEpoch((epoch) => epoch + 1)
        }
      } else if (status.phase === 'reconnecting') {
        settings.setConnectionMessage(message)
      } else if (status.phase === 'error' || status.phase === 'idle') {
        settings.setEngineBootstrap({ status: 'unreachable', message, version: null })
        settings.setConnectionMessage(message)
      }
    })
    return () => {
      active = false
      unsubscribe()
      void disconnectRemoteSsh()
    }
  }, [deploymentMode, sshHost])

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
        const safeApiUrl = localBundle
          ? 'http://127.0.0.1:18790/api'
          : (typeof apiUrl === 'string' ? apiUrl : 'http://127.0.0.1:18790/api')

        if (deploymentMode === 'remoteSsh') {
          const unreachable = (message: string) => {
            setEngineBootstrap({ status: 'unreachable', message, version: null })
            setConnectionMessage(message)
            setConnected(false)
          }
          if (!hasRemoteSshBridge()) return unreachable(t('sshErrorUnavailable', lang))
          if (!sshHost.trim()) return unreachable(t('sshHostRequired', lang))
          setConnectionMessage(t('sshStatusConnecting', lang, { host: sshHost.trim() }))
          // Idempotent: attach again re-reads port and token, so a changed
          // remote command or a restarted engine is picked up here.
          const status = await connectRemoteSsh(sshHost, sshMiraCommand)
          if (disposed) return
          useRemoteSshStore.getState().setStatus(status)
          if (status.phase !== 'connected' || !status.localPort) {
            return unreachable(remoteSshMessage(status, lang, sshHost.trim(), sshMiraCommand))
          }
          const endpoints = tunnelEndpoints(status.localPort)
          const settings = useSettingsStore.getState()
          if (endpoints.apiUrl !== settings.apiUrl || endpoints.wsUrl !== settings.wsUrl) {
            // This effect runs again for the new endpoint and probes it there.
            forgetRemoteSshToken()
            settings.setConnectionEndpoints(endpoints.apiUrl, endpoints.wsUrl)
            return
          }
        }

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
  }, [apiUrl, deploymentMode, sshHost, sshMiraCommand, sshEpoch, setConnected, setConnectionMessage, setEngineBootstrap, setLocalEngineBootstrap])

  useEffect(() => {
    const localBundle = deploymentMode === 'localBundle'
    const safeWsUrl = localBundle ? 'ws://127.0.0.1:18790/ws' : wsUrl

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
