import { useEffect, useRef, useState } from 'react'
import { engineTokenOrigin, useSettingsStore, type DeploymentMode, type Theme, type Language, type SendShortcut } from '@/stores/settingsStore'
import { probeEngineCompatibility } from '@/services/engine'
import {
  fetchRuntimeConfig,
  updateProjectsRoot,
  type RuntimeConfigPayload,
} from '@/services/runtimeConfig'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { EngineLifecycleControls } from './EngineLifecycleControls'
import { exportDiagnostics, recordDiagnostic } from '@/services/diagnostics'
import { isUnencryptedRemoteEndpoint, sshTunnelSuggestion } from '@/lib/connectionSecurity'
import { connectRemoteSsh, disconnectRemoteSsh, hasRemoteSshBridge, listSshHosts } from '@/services/remoteSsh'
import { useRemoteSshStore } from '@/stores/remoteSshStore'
import { remoteSshMessage } from '@/lib/remoteSshMessages'
import { parseServerUrl, serverHost, serverOrigin } from '@/lib/teamServerUrl'
import {
  fetchTeamServerInfo,
  hasTeamServerBridge,
  serverUrlErrorMessage,
  signOutTeamServer,
  teamServerFailureMessage,
} from '@/services/teamServer'
import { requestTeamServerLogin, useTeamServerStore } from '@/stores/teamServerStore'

const LOCAL_API_URL = 'http://127.0.0.1:18790/api'
const LOCAL_WS_URL = 'ws://127.0.0.1:18790/ws'

type SettingsDraft = {
  workspacePath: string
  theme: Theme
  language: Language
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  engineToken: string
  sshHost: string
  sshMiraCommand: string
  serverUrl: string
  showProgressMessages: boolean
  showToolCallHistory: boolean
  streamResponses: boolean
  sendShortcut: SendShortcut
  receivePrereleases: boolean
}

function remoteApiFallback(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  return `http://${host}:18790/api`
}

function remoteWsFallback(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${host}:18790/ws`
}

function storedEngineToken(store: ReturnType<typeof useSettingsStore.getState>, apiUrl: string): string {
  const origin = engineTokenOrigin(apiUrl)
  return origin ? store.engineTokens[origin] ?? '' : ''
}

function createDraft(store: ReturnType<typeof useSettingsStore.getState>): SettingsDraft {
  return {
    workspacePath: store.workspacePath,
    theme: store.theme,
    language: store.language,
    deploymentMode: store.deploymentMode,
    apiUrl: store.apiUrl,
    wsUrl: store.wsUrl,
    engineToken: storedEngineToken(store, store.apiUrl),
    sshHost: store.sshHost ?? '',
    sshMiraCommand: store.sshMiraCommand ?? '',
    serverUrl: store.serverUrl ?? '',
    showProgressMessages: store.showProgressMessages,
    showToolCallHistory: store.showToolCallHistory ?? false,
    streamResponses: store.streamResponses ?? true,
    sendShortcut: store.sendShortcut ?? 'enter',
    receivePrereleases: store.receivePrereleases ?? false,
  }
}

function runtimeWorkspacePath(payload: RuntimeConfigPayload): string {
  return payload.runtime.workspace || payload.projects_root
}

function applyRuntimePayload(
  draft: SettingsDraft,
  payload: RuntimeConfigPayload,
  endpoints?: { apiUrl: string; wsUrl: string },
): SettingsDraft {
  return {
    ...draft,
    workspacePath: runtimeWorkspacePath(payload),
    apiUrl: endpoints?.apiUrl ?? draft.apiUrl,
    wsUrl: endpoints?.wsUrl ?? draft.wsUrl,
  }
}

function resetWorkspaceScopedState() {
  useAgentStore.getState().resetWorkspaceState()
  useProjectStore.getState().resetWorkspaceState()
}

// Runtime fields a background refresh would otherwise clobber. When the user
// has already edited one (current differs from the seed snapshot taken at
// open), keep their value instead of overwriting it with the late server read.
const PRESERVED_DRAFT_FIELDS = ['workspacePath', 'apiUrl', 'wsUrl'] as const

function mergePreservingEdits(
  current: SettingsDraft,
  seed: SettingsDraft,
  fresh: SettingsDraft,
): SettingsDraft {
  const next: SettingsDraft = { ...current }
  for (const field of PRESERVED_DRAFT_FIELDS) {
    const userEdited = current[field] !== seed[field]
    if (!userEdited) {
      ;(next as Record<string, unknown>)[field] = fresh[field]
    }
  }
  return next
}

function workspacePathChanged(previous: string, next: string): boolean {
  return previous.trim() !== next.trim()
}

function endpointChanged(previousApiUrl: string, previousWsUrl: string, nextApiUrl: string, nextWsUrl: string): boolean {
  return previousApiUrl.trim() !== nextApiUrl.trim() || previousWsUrl.trim() !== nextWsUrl.trim()
}

function latestStoredProfile(
  profiles: ReturnType<typeof useSettingsStore.getState>['engineProfiles'],
  mode: DeploymentMode,
) {
  return Object.values(profiles)
    .filter((profile) => profile.deploymentMode === mode)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}

export function SettingsModal() {
  const store = useSettingsStore()
  const { settingsOpen, closeSettings } = store
  const remoteSshStatus = useRemoteSshStore((s) => s.status)
  const [sshHosts, setSshHosts] = useState<string[]>([])
  const openProviders = useUiStore((s) => s.openProviders)
  const showEngineWarning = store.engineStatus === 'incompatible' || store.engineStatus === 'unreachable' || store.engineStatus === 'setup_required' || store.localEnginePhase === 'error'

  const [draft, setDraft] = useState<SettingsDraft>(() => createDraft(store))
  const [busy, setBusy] = useState(false)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)
  const [workspaceEdited, setWorkspaceEdited] = useState(false)
  const [diagnosticsFeedback, setDiagnosticsFeedback] = useState<{ message: string; error: boolean } | null>(null)
  // "Specify path manually" in the Remote-SSH install dialog lands here.
  const miraCommandFocus = useRemoteSshStore((s) => s.miraCommandFocus)
  const miraCommandRef = useRef<HTMLInputElement>(null)

  // Snapshot of the draft when the modal opened. A late background refresh
  // diffs against it so it never overwrites fields the user already changed.
  const seedRef = useRef<SettingsDraft>(draft)
  // Monotonic token: only the most recent load is allowed to mutate state, so a
  // slow response from a previous open/refresh can't clobber a newer one.
  const loadTokenRef = useRef(0)

  const curLang = draft.language
  const projectLocation = store.runtimeConfig?.project_location
  const customProjectDirsAllowed = projectLocation?.custom_dir_allowed ?? true

  const loadRuntimeConfig = async (
    mode: DeploymentMode,
    apiUrlOverride?: string,
    commitToStore = true,
    preserveEdits = false,
  ) => {
    const token = ++loadTokenRef.current
    setRuntimeLoading(true)
    setFeedback(null)
    setFeedbackError(false)
    try {
      const targetApiUrl = mode === 'localBundle' ? LOCAL_API_URL : (apiUrlOverride?.trim() || draft.apiUrl.trim())

      // Opening Settings and refreshing config are read-only. In particular,
      // never restart an engine the user deliberately stopped in this dialog.

      const payload = await fetchRuntimeConfig(targetApiUrl)
      if (loadTokenRef.current !== token) return
      if (commitToStore) {
        store.setRuntimeConfig(payload)
        store.setRuntimeConfigLoaded(true)
        store.setRuntimeConfigError(null)
      }
      setWorkspaceEdited(false)
      const endpoints = {
        apiUrl: targetApiUrl,
        wsUrl: mode === 'localBundle' ? LOCAL_WS_URL : (seedRef.current.wsUrl || draft.wsUrl),
      }
      setDraft((current) => {
        // Background "refresh on open" preserves edits the user may have already
        // typed. Explicit refreshes / mode switches replace the draft outright.
        if (preserveEdits) {
          const fresh = { ...applyRuntimePayload(seedRef.current, payload, endpoints), deploymentMode: mode }
          return mergePreservingEdits(current, seedRef.current, fresh)
        }
        return { ...applyRuntimePayload(current, payload, endpoints), deploymentMode: mode }
      })
    } catch (error) {
      if (loadTokenRef.current !== token) return
      const message = error instanceof Error ? error.message : String(error)
      if (commitToStore) {
        store.setRuntimeConfigError(message)
        store.setRuntimeConfigLoaded(false)
      }
      setFeedbackError(true)
      setFeedback(message)
    } finally {
      if (loadTokenRef.current === token) {
        setRuntimeLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!settingsOpen) return
    const nextDraft = createDraft(store)
    seedRef.current = nextDraft
    setDraft(nextDraft)
    setBusy(false)
    setRuntimeLoading(false)
    setFeedbackError(false)
    setFeedback(null)
    setDiagnosticsFeedback(null)
    setWorkspaceEdited(false)
    if (hasRemoteSshBridge()) void listSshHosts().then(setSshHosts)
    // A Remote-SSH engine is only reachable while its tunnel is up.
    if (store.deploymentMode === 'remoteSsh' && useRemoteSshStore.getState().status.phase !== 'connected') return
    // A Team server engine is only reachable while signed in.
    if (store.deploymentMode === 'teamServer' && useTeamServerStore.getState().phase !== 'signedIn') return
    void loadRuntimeConfig(store.deploymentMode, store.apiUrl, true, true)
  }, [settingsOpen])

  useEffect(() => {
    if (!settingsOpen || !miraCommandFocus) return
    const timer = setTimeout(() => {
      miraCommandRef.current?.scrollIntoView?.({ block: 'center' })
      miraCommandRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [settingsOpen, miraCommandFocus])

  if (!settingsOpen) return null

  const handleSwitchMode = (mode: DeploymentMode) => {
    if (busy) return
    if (mode === 'teamServer') {
      const storedServer = latestStoredProfile(store.engineProfiles, 'teamServer')
      setDraft((current) => ({
        ...current,
        deploymentMode: mode,
        serverUrl: current.serverUrl || store.serverUrl || storedServer?.serverUrl || '',
        workspacePath: storedServer?.workspacePath ?? current.workspacePath,
      }))
      setWorkspaceEdited(false)
      return
    }
    if (mode === 'remoteSsh') {
      const storedSsh = latestStoredProfile(store.engineProfiles, 'remoteSsh')
      setDraft((current) => ({
        ...current,
        deploymentMode: mode,
        sshHost: current.sshHost || store.sshHost || storedSsh?.sshHost || '',
        sshMiraCommand: current.sshMiraCommand || store.sshMiraCommand || storedSsh?.sshMiraCommand || '',
        workspacePath: storedSsh?.workspacePath ?? current.workspacePath,
      }))
      setWorkspaceEdited(false)
      return
    }
    const storedRemote = mode === 'remoteManual'
      ? latestStoredProfile(store.engineProfiles, 'remoteManual')
      : null
    setDraft((current) => {
      const base = storedRemote?.runtimeConfig
        ? applyRuntimePayload(current, storedRemote.runtimeConfig, {
            apiUrl: storedRemote.apiUrl,
            wsUrl: storedRemote.wsUrl,
          })
        : current
      return {
        ...base,
        deploymentMode: mode,
        apiUrl: mode === 'localBundle'
          ? LOCAL_API_URL
          : storedRemote?.apiUrl ?? (current.apiUrl === LOCAL_API_URL || current.deploymentMode === 'teamServer' ? remoteApiFallback() : current.apiUrl),
        wsUrl: mode === 'localBundle'
          ? LOCAL_WS_URL
          : storedRemote?.wsUrl ?? (current.wsUrl === LOCAL_WS_URL || current.deploymentMode === 'teamServer' ? remoteWsFallback() : current.wsUrl),
        workspacePath: storedRemote?.workspacePath ?? base.workspacePath,
        engineToken: mode === 'localBundle'
          ? current.engineToken
          : storedEngineToken(store, storedRemote?.apiUrl ?? current.apiUrl),
      }
    })
    if (mode === 'localBundle') {
      void loadRuntimeConfig(mode, LOCAL_API_URL, false)
    }
    setWorkspaceEdited(false)
  }

  const handleSave = async () => {
    const nextApiUrl = draft.apiUrl.trim()
    const nextWsUrl = draft.wsUrl.trim()
    const nextWorkspacePath = draft.workspacePath.trim()
    const previousApiUrl = store.apiUrl
    const previousWsUrl = store.wsUrl
    const previousWorkspacePath = store.workspacePath
    const local = draft.deploymentMode === 'localBundle'
    setBusy(true)
    setFeedback(null)
    setFeedbackError(false)

    try {
      store.setTheme(draft.theme)
      store.setLanguage(draft.language)
      store.setShowProgressMessages(draft.showProgressMessages)
      store.setShowToolCallHistory(draft.showToolCallHistory)
      store.setStreamResponses(draft.streamResponses)
      store.setSendShortcut(draft.sendShortcut)
      store.setReceivePrereleases(draft.receivePrereleases)

      if (draft.deploymentMode === 'remoteSsh') {
        await saveRemoteSsh(nextWorkspacePath)
        closeSettings()
        return
      }

      if (draft.deploymentMode === 'teamServer') {
        await saveTeamServer(nextWorkspacePath)
        closeSettings()
        return
      }

      if (!local && (!nextApiUrl || !nextWsUrl)) {
        throw new Error(t('settingsRemoteRequiresUrls', curLang))
      }

      const targetApiUrl = local ? LOCAL_API_URL : nextApiUrl
      const targetWsUrl = local ? LOCAL_WS_URL : nextWsUrl
      // The token must be in place before the engine is contacted below.
      if (!local) store.setEngineToken(targetApiUrl, draft.engineToken)

      // Saving preferences must not undo an explicit Stop. Engine lifecycle
      // is handled by the dedicated controls; runtime writes require it online.

      const switchedEngine = store.deploymentMode !== draft.deploymentMode
        || endpointChanged(previousApiUrl, previousWsUrl, targetApiUrl, targetWsUrl)

      // Provider credentials, model lists, and runtime knobs all live on the
      // dedicated Providers page now and persist to whichever engine is active,
      // so local and remote behave identically. Settings only reads the config
      // and (optionally) moves the workspace root.
      let payload = await fetchRuntimeConfig(targetApiUrl)
      const engineCustomDirsAllowed = payload.project_location?.custom_dir_allowed ?? true
      const engineWorkspacePath = runtimeWorkspacePath(payload)
      const shouldUpdateWorkspace = engineCustomDirsAllowed
        && workspaceEdited
        && workspacePathChanged(engineWorkspacePath, nextWorkspacePath)
      if (shouldUpdateWorkspace) {
        payload = await updateProjectsRoot(nextWorkspacePath, targetApiUrl)
      }

      const resolvedWorkspacePath = runtimeWorkspacePath(payload)
      const workspaceChanged = switchedEngine || workspacePathChanged(previousWorkspacePath, resolvedWorkspacePath)
      if (workspaceChanged) {
        resetWorkspaceScopedState()
      }
      store.setDeploymentMode(draft.deploymentMode)
      store.setConnectionEndpoints(targetApiUrl, targetWsUrl)
      store.setRuntimeConfig(payload)
      store.setRuntimeConfigLoaded(true)
      store.setRuntimeConfigError(null)
      setWorkspaceEdited(false)
      setDraft((current) => applyRuntimePayload(current, payload, {
        apiUrl: targetApiUrl,
        wsUrl: targetWsUrl,
      }))

      const probe = await probeEngineCompatibility(targetApiUrl)
      store.setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
        uptimeSeconds: probe.uptimeSeconds,
      })
      // The project list only changes when the workspace root moves; skip the
      // expensive per-project plan/contract refetch otherwise.
      if (workspaceChanged) {
        await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
      }

      closeSettings()
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const sameSshEngine = (host: string) => store.deploymentMode === 'remoteSsh' && store.sshHost.trim() === host

  // Switching to (or between) Remote-SSH hosts only updates settings; the
  // connection itself is driven by useWebSocket. The workspace root can only
  // be moved on an engine that is connected right now.
  const saveRemoteSsh = async (nextWorkspacePath: string) => {
    const host = draft.sshHost.trim()
    if (!host) throw new Error(t('sshHostRequired', curLang))
    if (sameSshEngine(host)) {
      // A new remote command reconnects (useWebSocket re-runs attach).
      store.setSshMiraCommand(draft.sshMiraCommand)
      const connected = remoteSshStatus.phase === 'connected' && remoteSshStatus.host === host
      if (connected && workspaceEdited && customProjectDirsAllowed
        && workspacePathChanged(store.workspacePath, nextWorkspacePath)) {
        const payload = await updateProjectsRoot(nextWorkspacePath, store.apiUrl)
        resetWorkspaceScopedState()
        store.setRuntimeConfig(payload)
        await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
      }
      return
    }
    resetWorkspaceScopedState()
    store.setSshManuallyDisconnected(false)
    store.setDeploymentMode('remoteSsh')
    store.setSshHost(host)
    store.setSshMiraCommand(draft.sshMiraCommand)
  }

  const sameTeamServer = (origin: string) => store.deploymentMode === 'teamServer' && store.serverUrl === origin

  // Switching to (or between) Team servers checks the URL and updates
  // settings; useWebSocket then signs in silently with a stored session, or
  // shows "Signed out" until the user clicks Sign in.
  const saveTeamServer = async (nextWorkspacePath: string) => {
    const parsed = parseServerUrl(draft.serverUrl)
    if (!parsed.ok) throw new Error(serverUrlErrorMessage(parsed.error, curLang))
    if (sameTeamServer(parsed.origin)) {
      const signedIn = useTeamServerStore.getState().phase === 'signedIn' && store.engineStatus === 'compatible'
      if (signedIn && workspaceEdited && customProjectDirsAllowed
        && workspacePathChanged(store.workspacePath, nextWorkspacePath)) {
        const payload = await updateProjectsRoot(nextWorkspacePath, store.apiUrl)
        resetWorkspaceScopedState()
        store.setRuntimeConfig(payload)
        await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
      }
      return
    }
    const info = await fetchTeamServerInfo(parsed.origin)
    if (!info.ok) throw new Error(teamServerFailureMessage(info, curLang, parsed.origin))
    resetWorkspaceScopedState()
    store.setTeamServer(parsed.origin)
  }

  const handleTeamServerSignIn = async () => {
    setFeedback(null)
    setFeedbackError(false)
    const parsed = parseServerUrl(draft.serverUrl)
    if (!parsed.ok) {
      setFeedbackError(true)
      setFeedback(serverUrlErrorMessage(parsed.error, curLang))
      return
    }
    setBusy(true)
    setFeedback(t('teamServerChecking', curLang, { host: parsed.host }))
    try {
      const info = await fetchTeamServerInfo(parsed.origin)
      if (!info.ok) {
        setFeedbackError(true)
        setFeedback(teamServerFailureMessage(info, curLang, parsed.origin))
        return
      }
      setFeedback(null)
      setDraft((current) => ({ ...current, serverUrl: parsed.origin }))
      if (!(await requestTeamServerLogin(parsed.origin, 'settings'))) return
      if (!sameTeamServer(parsed.origin)) {
        resetWorkspaceScopedState()
        store.setTeamServer(parsed.origin)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleTeamServerSignOut = async () => {
    const origin = serverOrigin(store.serverUrl)
    if (!origin) return
    setBusy(true)
    try {
      await signOutTeamServer(origin)
    } finally {
      setBusy(false)
    }
  }

  const handleSshConnect = async () => {
    const host = draft.sshHost.trim()
    setFeedback(null)
    setFeedbackError(false)
    if (!host) {
      setFeedbackError(true)
      setFeedback(t('sshHostRequired', curLang))
      return
    }
    store.setSshManuallyDisconnected(false)
    if (!sameSshEngine(host)) {
      resetWorkspaceScopedState()
      store.setDeploymentMode('remoteSsh')
      store.setSshHost(host)
      store.setSshMiraCommand(draft.sshMiraCommand)
      return
    }
    store.setSshMiraCommand(draft.sshMiraCommand)
    useRemoteSshStore.getState().setStatus(await connectRemoteSsh(host, draft.sshMiraCommand))
  }

  // Remembered across launches: the app stays disconnected until Connect.
  const handleSshDisconnect = async () => {
    const host = store.sshHost.trim()
    store.setSshManuallyDisconnected(true)
    useRemoteSshStore.getState().setStatus(await disconnectRemoteSsh())
    const message = t('sshStatusDisconnected', curLang, { host })
    store.setEngineBootstrap({ status: 'unreachable', message, version: null })
    store.setConnectionMessage(message)
  }

  const handleExportDiagnostics = async () => {
    setBusy(true)
    setDiagnosticsFeedback(null)
    try {
      const file = await exportDiagnostics(localMode)
      if (file) setDiagnosticsFeedback({ message: t('diagnosticsExported', curLang), error: false })
    } catch (error) {
      recordDiagnostic('diagnostics.export_failed', {}, error)
      setDiagnosticsFeedback({ message: t('diagnosticsExportFailed', curLang), error: true })
    } finally { setBusy(false) }
  }

  const localMode = draft.deploymentMode === 'localBundle'
  const sshMode = draft.deploymentMode === 'remoteSsh'
  const directMode = draft.deploymentMode === 'remoteManual'
  const teamMode = draft.deploymentMode === 'teamServer'
  const draftServerOrigin = serverOrigin(draft.serverUrl)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />
      <div className="relative w-[680px] max-w-[calc(100vw-32px)] max-h-[84vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {t('settings', curLang)}
          </h2>
          <button
            onClick={closeSettings}
            disabled={busy}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <Section title={t('connection', curLang)}>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] overflow-hidden">
              <DeploymentModeTabs mode={draft.deploymentMode} onChange={handleSwitchMode} lang={curLang} />
              <div
                role="tabpanel"
                id={deploymentPanelId}
                aria-labelledby={deploymentTabId(draft.deploymentMode)}
                className="px-4 py-4"
              >
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                  {t(localMode ? 'deploymentLocalHint' : sshMode ? 'deploymentSshHint' : teamMode ? 'deploymentTeamServerHint' : 'deploymentDirectHint', curLang)}
                </p>

                {localMode && (
                  <div className="mt-4">
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-3 space-y-1">
                      <p className="text-sm text-[var(--color-text-primary)]">
                        Phase: <span className="font-medium">{store.localEnginePhase}</span>
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {store.engineVersion ? `Version ${store.engineVersion}` : 'Version unknown'}
                      </p>
                      {store.localEngineExecutablePath && (
                        <p className="text-[11px] text-[var(--color-text-muted)] break-all">
                          Executable: {store.localEngineExecutablePath}
                        </p>
                      )}
                      {showEngineWarning && (
                        <p className="text-[11px] text-amber-300 leading-relaxed">
                          {store.engineMessage || 'Local engine needs provider setup or an engine update.'}
                        </p>
                      )}
                      {store.runtimeConfig?.config_path && (
                        <p className="text-[11px] text-[var(--color-text-muted)] break-all">
                          Runtime config path: {store.runtimeConfig.config_path}
                        </p>
                      )}
                    </div>
                    <EngineLifecycleControls busy={busy || runtimeLoading} onBusyChange={setBusy} />
                  </div>
                )}

                {sshMode && (
                  <div className="mt-4">
                    <Label text={t('sshHostLabel', curLang)} />
                    <input
                      value={draft.sshHost}
                      list="mira-ssh-hosts"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('sshHostPlaceholder', curLang)}
                      onChange={(e) => setDraft((current) => ({ ...current, sshHost: e.target.value }))}
                      className={inputClass}
                    />
                    <datalist id="mira-ssh-hosts">
                      {sshHosts.map((host) => <option key={host} value={host} />)}
                    </datalist>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                      {t('sshHostHint', curLang)}
                    </p>
                    <Label text={t('sshMiraCommandLabel', curLang)} className="mt-3" />
                    <input
                      ref={miraCommandRef}
                      aria-label={t('sshMiraCommandLabel', curLang)}
                      value={draft.sshMiraCommand}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="mira"
                      onChange={(e) => setDraft((current) => ({ ...current, sshMiraCommand: e.target.value }))}
                      className={inputClass}
                    />
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                      {t('sshMiraCommandHint', curLang)}
                    </p>
                    <RemoteSshStatusLine
                      lang={curLang}
                      host={draft.sshHost.trim()}
                      active={sameSshEngine(draft.sshHost.trim())}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionButton disabled={busy || !draft.sshHost.trim()} onClick={() => void handleSshConnect()}>
                        {sameSshEngine(draft.sshHost.trim()) && remoteSshStatus.phase === 'error'
                          ? t('sshReconnect', curLang)
                          : t('sshConnect', curLang)}
                      </ActionButton>
                      {sameSshEngine(draft.sshHost.trim()) && remoteSshStatus.phase !== 'idle' && (
                        <ActionButton disabled={busy} onClick={() => void handleSshDisconnect()}>
                          {t('sshDisconnect', curLang)}
                        </ActionButton>
                      )}
                    </div>
                  </div>
                )}

                {teamMode && (
                  <div className="mt-4">
                    <Label text={t('teamServerUrlLabel', curLang)} />
                    <input
                      aria-label={t('teamServerUrlLabel', curLang)}
                      value={draft.serverUrl}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('teamServerUrlPlaceholder', curLang)}
                      onChange={(e) => setDraft((current) => ({ ...current, serverUrl: e.target.value }))}
                      className={inputClass}
                    />
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                      {t('teamServerUrlHint', curLang)}
                    </p>
                    <TeamServerStatusLine
                      lang={curLang}
                      origin={draftServerOrigin}
                      active={draftServerOrigin !== null && sameTeamServer(draftServerOrigin)}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionButton disabled={busy || !draft.serverUrl.trim()} onClick={() => void handleTeamServerSignIn()}>
                        {t('teamServerSignIn', curLang)}
                      </ActionButton>
                      {draftServerOrigin && sameTeamServer(draftServerOrigin) && (
                        <TeamServerSignOutButton disabled={busy} lang={curLang} origin={draftServerOrigin} onClick={() => void handleTeamServerSignOut()} />
                      )}
                    </div>
                  </div>
                )}

                {directMode && (
                  <div className="mt-4">
                    <Label text={t('apiUrl', curLang)} />
                    <input
                      value={draft.apiUrl}
                      onChange={(e) => setDraft((current) => ({ ...current, apiUrl: e.target.value }))}
                      className={inputClass}
                    />
                    <Label text={t('wsUrl', curLang)} className="mt-3" />
                    <input
                      value={draft.wsUrl}
                      onChange={(e) => setDraft((current) => ({ ...current, wsUrl: e.target.value }))}
                      className={inputClass}
                    />
                    <InsecureRemoteWarning apiUrl={draft.apiUrl} wsUrl={draft.wsUrl} lang={curLang} />
                    <Label text={t('engineToken', curLang)} className="mt-3" />
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={draft.engineToken}
                      placeholder={t('engineTokenPlaceholder', curLang)}
                      onChange={(e) => setDraft((current) => ({ ...current, engineToken: e.target.value }))}
                      className={inputClass}
                    />
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                      {t('engineTokenHint', curLang)}
                    </p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-2 leading-relaxed">
                      Remote deployment is not bundled. Install `mira` on your remote server separately, then enter its API and WebSocket endpoints here.
                    </p>
                    <div className="mt-3">
                      <ActionButton
                        disabled={busy || runtimeLoading || !draft.apiUrl.trim()}
                        onClick={() => {
                          store.setEngineToken(draft.apiUrl, draft.engineToken)
                          void loadRuntimeConfig('remoteManual', draft.apiUrl, false)
                        }}
                      >
                        {runtimeLoading ? 'Refreshing...' : 'Refresh from engine'}
                      </ActionButton>
                    </div>
                  </div>
                )}

                {/* The projects root belongs to whichever engine this tab connects to. */}
                <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
                  <Label text={t('workspacePath', curLang)} />
                  <input
                    value={draft.workspacePath}
                    onChange={(e) => {
                      setWorkspaceEdited(true)
                      setDraft((current) => ({ ...current, workspacePath: e.target.value }))
                    }}
                    disabled={!customProjectDirsAllowed}
                    className={cn(inputClass, !customProjectDirsAllowed && 'cursor-not-allowed opacity-70')}
                  />
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                    {customProjectDirsAllowed
                      ? t('workspacePathHint', curLang)
                      : t('managedProjectLocationHint', curLang)}
                  </p>
                </div>

                {feedback && (
                  <p className={cn('mt-4 text-xs leading-relaxed whitespace-pre-wrap break-words', feedbackError ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
                    {feedback}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section title={t('manageProviders', curLang)}>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed flex-1">
                  {t('settingsProvidersHint', curLang)}
                </p>
                <ActionButton
                  onClick={() => {
                    closeSettings()
                    openProviders()
                  }}
                >
                  {t('manageProviders', curLang)}
                </ActionButton>
              </div>
            </div>
          </Section>

          <Section title={t('onboardingProfileSection', curLang)}>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed flex-1">
                  {t('onboardingProfileSectionHint', curLang)}
                </p>
                <ActionButton
                  onClick={() => {
                    closeSettings()
                    useUiStore.getState().openOnboarding()
                  }}
                >
                  {t('onboardingEditProfile', curLang)}
                </ActionButton>
              </div>
            </div>
          </Section>

          <Section title={t('general', curLang)}>
            <Label text={t('theme', curLang)} />
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((th) => (
                <button
                  key={th}
                  onClick={() => setDraft((current) => ({ ...current, theme: th as Theme }))}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg border transition-colors',
                    draft.theme === th
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {th === 'dark' ? '🌙 ' : '☀️ '}
                  {t(th, curLang)}
                </button>
              ))}
            </div>

            <Label text={t('language', curLang)} className="mt-4" />
            <div className="flex gap-2">
              {([
                { value: 'en' as Language, label: 'English' },
                { value: 'zh' as Language, label: '中文' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDraft((current) => ({ ...current, language: opt.value }))}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg border transition-colors',
                    draft.language === opt.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <ToggleRow
              className="mt-4"
              label={t('progressMessages', curLang)}
              checked={draft.showProgressMessages}
              onToggle={() => setDraft((current) => ({ ...current, showProgressMessages: !current.showProgressMessages }))}
            />
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('progressMessagesHint', curLang)}
            </p>

            <ToggleRow
              className="mt-4"
              label={t('toolCallHistory', curLang)}
              checked={draft.showToolCallHistory}
              onToggle={() => setDraft((current) => ({ ...current, showToolCallHistory: !current.showToolCallHistory }))}
            />
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('toolCallHistoryHint', curLang)}
            </p>

            <ToggleRow
              className="mt-4"
              label={t('streamResponses', curLang)}
              checked={draft.streamResponses}
              onToggle={() => setDraft((current) => ({ ...current, streamResponses: !current.streamResponses }))}
            />
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('streamResponsesHint', curLang)}
            </p>

            <Label text={t('sendShortcut', curLang)} className="mt-4" />
            <div className="flex gap-2">
              {([
                { value: 'enter' as SendShortcut, label: t('enterToSend', curLang) },
                { value: 'shift_enter' as SendShortcut, label: t('shiftEnterToSend', curLang) },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, sendShortcut: option.value }))}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg border transition-colors',
                    draft.sendShortcut === option.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Section>

          <AppUpdatesSection
            lang={curLang}
            receivePrereleases={draft.receivePrereleases}
            setReceivePrereleases={(receivePrereleases) => setDraft((current) => ({ ...current, receivePrereleases }))}
          />

          <Section title={t('diagnosticsTitle', curLang)}>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">{t('diagnosticsHint', curLang)}</p>
            <ActionButton disabled={busy} onClick={handleExportDiagnostics}>
              {t('diagnosticsExport', curLang)}
            </ActionButton>
            {diagnosticsFeedback && (
              <p className={cn('mt-2 text-xs leading-relaxed', diagnosticsFeedback.error ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
                {diagnosticsFeedback.message}
              </p>
            )}
          </Section>

          <FeedbackSection lang={curLang} onClose={closeSettings} />
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={closeSettings}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {t('cancel', curLang)}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={busy || runtimeLoading}
            className={cn(
              'px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium transition-colors',
              busy || runtimeLoading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[var(--color-accent)]/80',
            )}
          >
            {busy ? 'Saving...' : t('save', curLang)}
          </button>
        </div>
      </div>
    </div>
  )
}

function InsecureRemoteWarning({ apiUrl, wsUrl, lang }: { apiUrl: string; wsUrl: string; lang: Language }) {
  const insecureUrl = [apiUrl, wsUrl].find(isUnencryptedRemoteEndpoint)
  const suggestion = insecureUrl ? sshTunnelSuggestion(insecureUrl) : null
  if (!insecureUrl || !suggestion) return null
  const scheme = new URL(insecureUrl.trim()).protocol.replace(':', '')
  return (
    <div role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <p className="text-xs font-medium text-amber-300">{t('insecureRemoteTitle', lang)}</p>
      <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed break-words">
        {t('insecureRemoteWarning', lang, { scheme, ...suggestion })}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

function Label({ text, className }: { text: string; className?: string }) {
  return (
    <label className={cn('block text-sm text-[var(--color-text-secondary)] mb-1.5', className)}>
      {text}
    </label>
  )
}

const deploymentPanelId = 'settings-deployment-panel'

function deploymentTabId(mode: DeploymentMode): string {
  return `settings-deployment-tab-${mode}`
}

// One tab per deployment mode: picking a tab switches the mode, and the panel
// below holds only that mode's parameters.
function DeploymentModeTabs(
  { mode, onChange, lang }: { mode: DeploymentMode; onChange: (mode: DeploymentMode) => void; lang: Language },
) {
  const options: Array<{ value: DeploymentMode; label: string; deprecated?: boolean }> = [
    { value: 'localBundle', label: t('deploymentLocal', lang) },
    // Remote-SSH needs the desktop app's ssh bridge.
    ...(hasRemoteSshBridge() || mode === 'remoteSsh' ? [{ value: 'remoteSsh' as const, label: t('deploymentSsh', lang) }] : []),
    // Team server sign-in runs in the desktop app's main process.
    ...(hasTeamServerBridge() || mode === 'teamServer' ? [{ value: 'teamServer' as const, label: t('deploymentTeamServer', lang) }] : []),
    { value: 'remoteManual', label: t('deploymentDirect', lang), deprecated: true },
  ]
  const tabRefs = useRef<Partial<Record<DeploymentMode, HTMLButtonElement | null>>>({})

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === mode)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % options.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else return
    event.preventDefault()
    const target = options[next].value
    onChange(target)
    tabRefs.current[target]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={t('deploymentModeTitle', lang)}
      onKeyDown={handleKeyDown}
      className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
    >
      {options.map((option) => {
        const selected = mode === option.value
        return (
          <button
            key={option.value}
            ref={(el) => { tabRefs.current[option.value] = el }}
            id={deploymentTabId(option.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={deploymentPanelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex-1 min-w-0 px-2 py-2.5 text-xs transition-colors',
              selected
                ? 'bg-[var(--color-bg-primary)] text-[var(--color-accent)] font-medium'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]',
            )}
          >
            {option.label}
            {option.deprecated && (
              <span className="ml-1 text-[10px] font-normal text-[var(--color-text-muted)]">({t('deploymentDeprecated', lang)})</span>
            )}
            {selected && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--color-accent)]" />}
          </button>
        )
      })}
    </div>
  )
}

function RemoteSshStatusLine({ lang, host, active }: { lang: Language; host: string; active: boolean }) {
  const status = useRemoteSshStore((s) => s.status)
  const miraCommand = useSettingsStore((s) => s.sshMiraCommand)
  // Status belongs to the host the store is connected to; an edited, not yet
  // connected host has no status to show.
  if (!active || status.phase === 'idle') return null
  const tone = status.phase === 'error'
    ? 'text-red-300'
    : status.phase === 'connected' ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-notice-text)]'
  return (
    <>
      <p role="status" className={cn('mt-2 text-[11px] leading-relaxed break-words', tone)}>
        {remoteSshMessage(status, lang, host, miraCommand)}
      </p>
      {status.phase === 'connected' && status.miraPath && (
        <p className="mt-1 text-[11px] font-mono break-all text-[var(--color-text-muted)]">
          {t('sshUsingMira', lang, { path: status.miraPath })}
        </p>
      )}
    </>
  )
}

function TeamServerStatusLine({ lang, origin, active }: { lang: Language; origin: string | null; active: boolean }) {
  const phase = useTeamServerStore((s) => s.phase)
  const sessionOrigin = useTeamServerStore((s) => s.origin)
  const user = useTeamServerStore((s) => s.user)
  const persistent = useTeamServerStore((s) => s.persistent)
  if (!origin || !active || sessionOrigin !== origin) return null
  const host = serverHost(origin)
  if (phase === 'signedIn' && user) {
    return (
      <>
        <p role="status" className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)] break-words">
          {t('teamServerSignedInAs', lang, { host, user: user.displayName || user.name })}
        </p>
        {!persistent && (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-notice-text)]">{t('teamServerNotPersistent', lang)}</p>
        )}
      </>
    )
  }
  if (phase === 'signedOut') {
    return (
      <p role="status" className="mt-2 text-[11px] leading-relaxed text-[var(--color-notice-text)] break-words">
        {t('teamServerSignedOut', lang, { host })}
      </p>
    )
  }
  return null
}

function TeamServerSignOutButton(
  { disabled, lang, origin, onClick }: { disabled: boolean; lang: Language; origin: string; onClick: () => void },
) {
  const signedIn = useTeamServerStore((s) => s.phase === 'signedIn' && s.origin === origin)
  if (!signedIn) return null
  return (
    <ActionButton disabled={disabled} onClick={onClick}>
      {t('teamServerSignOut', lang)}
    </ActionButton>
  )
}

function ToggleRow(
  { label, checked, onToggle, className }: { label: string; checked: boolean; onToggle: () => void; className?: string },
) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <Label text={label} className="mb-0" />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={cn(
          'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]',
        )}
      >
        <span
          className={cn(
            'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function ActionButton(
  { children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void },
) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs rounded-lg border transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)]'
          : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10',
      )}
    >
      {children}
    </button>
  )
}

const inputClass =
  'w-full h-10 bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'

function AppUpdatesSection(
  { lang, receivePrereleases, setReceivePrereleases }: {
    lang: Language
    receivePrereleases: boolean
    setReceivePrereleases: (v: boolean) => void
  },
) {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'up-to-date' }
    | { kind: 'available'; version: string; url: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const isDesktop = typeof window !== 'undefined' && !!window.electronAPI
  const setAvailableUpdate = useUiStore((s) => s.setAvailableUpdate)

  useEffect(() => {
    let cancelled = false
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (api?.getAppVersion) {
      void api.getAppVersion().then((v) => {
        if (!cancelled) setAppVersion(v)
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  const handleCheckNow = async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api?.checkForUpdates) return
    setChecking(true)
    setStatus({ kind: 'idle' })
    try {
      const info = await api.checkForUpdates({
        includePrereleases: receivePrereleases,
        forceRefresh: true,
      })
      if (info) {
        setStatus({ kind: 'available', version: info.version, url: info.url })
        setAvailableUpdate(info)
      } else {
        setStatus({ kind: 'up-to-date' })
        setAvailableUpdate(null)
      }
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setChecking(false)
    }
  }

  if (!isDesktop) {
    // Web mode: nothing to update; hide the section entirely to avoid
    // confusing remote-mode users who are already on the deployed gateway's
    // version.
    return null
  }

  return (
    <Section title={t('appUpdatesTitle', lang)}>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 space-y-1">
        <p className="text-sm text-[var(--color-text-primary)]">
          {t('currentVersionLabel', lang)}:{' '}
          <span className="font-mono">{appVersion ?? '…'}</span>
        </p>
        {status.kind === 'available' && (
          <p className="text-[11px] text-[var(--color-accent)]">
            {t('updateAvailableShort', lang, { version: status.version })}
          </p>
        )}
        {status.kind === 'up-to-date' && (
          <p className="text-[11px] text-[var(--color-text-muted)]">{t('updateUpToDate', lang)}</p>
        )}
        {status.kind === 'error' && (
          <p className="text-[11px] text-[var(--color-error)]">
            {t('updateCheckFailed', lang)}: {status.message}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton disabled={checking} onClick={handleCheckNow}>
          {checking ? t('updateChecking', lang) : t('updateCheckNow', lang)}
        </ActionButton>
      </div>

      <ToggleRow
        className="mt-4"
        label={t('updateReceivePrereleases', lang)}
        checked={receivePrereleases}
        onToggle={() => setReceivePrereleases(!receivePrereleases)}
      />
      <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
        {t('updateReceivePrereleasesHint', lang)}
      </p>
    </Section>
  )
}

function FeedbackSection({ lang, onClose }: { lang: Language; onClose: () => void }) {
  const openDialog = useFeedbackStore((s) => s.openDialog)
  const pendingCount = useFeedbackStore((s) => s.pendingCount)
  const [expanded, setExpanded] = useState(false)

  const handleOpenForm = () => {
    onClose()
    window.setTimeout(() => openDialog(), 0)
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-4 mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 group"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)] transition-colors flex items-center gap-2">
          <span className="inline-block w-3 text-center">{expanded ? '▾' : '▸'}</span>
          {t('feedbackHelpSection', lang)}
          {pendingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] normal-case tracking-normal">
              {pendingCount}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed flex-1">
              {t('feedbackHelpHint', lang)}
            </p>
            <button
              type="button"
              onClick={handleOpenForm}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
            >
              {t('feedbackOpenForm', lang)}
            </button>
          </div>
          {pendingCount > 0 && (
            <p className="text-[11px] text-amber-300">
              {t('feedbackPendingNotice', lang, { count: pendingCount })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
