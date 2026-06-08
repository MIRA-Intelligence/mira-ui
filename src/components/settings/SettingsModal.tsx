import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, type DeploymentMode, type Theme, type Language } from '@/stores/settingsStore'
import {
  bootstrapLocalEngine,
  doctorLocalEngine,
  repairLocalEngineService,
  startLocalEngine,
  stopLocalEngine,
  upgradeLocalEngine,
} from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import {
  fetchRuntimeConfig,
  saveRuntimeConfig,
  updateProjectsRoot,
  type ReasoningEffort,
  type RuntimeConfigPayload,
} from '@/services/runtimeConfig'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const LOCAL_API_URL = 'http://127.0.0.1:18790/api'
const LOCAL_WS_URL = 'ws://127.0.0.1:18790/ws'

const REASONING_OPTIONS: { value: Exclude<ReasoningEffort, null>; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'adaptive', label: 'Adaptive' },
]

function providerLabel(
  provider: string,
  providers: RuntimeConfigPayload['providers'],
): string {
  return providers[provider]?.display_name ?? provider
}

function buildProviderOptions(
  providers: RuntimeConfigPayload['providers'],
  selectedProvider: string,
): Array<{ value: string; label: string }> {
  const entries = Object.entries(providers).map(([value, settings]) => ({
    value,
    label: settings.display_name || value,
  }))
  if (selectedProvider && !providers[selectedProvider]) {
    return [{ value: selectedProvider, label: selectedProvider }, ...entries]
  }
  return entries
}

type SettingsDraft = {
  workspacePath: string
  theme: Theme
  language: Language
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  showProgressMessages: boolean
  showToolCallHistory: boolean
  streamResponses: boolean
  receivePrereleases: boolean
  provider: string
  model: string
  reasoningEffort: ReasoningEffort
  maxToolIterations: string
  restrictToWorkspace: boolean
  apiBase: string
  apiKey: string
}

type SettingsTab = 'connection' | 'localEngine'

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

function createDraft(store: ReturnType<typeof useSettingsStore.getState>): SettingsDraft {
  return {
    workspacePath: store.workspacePath,
    theme: store.theme,
    language: store.language,
    deploymentMode: store.deploymentMode,
    apiUrl: store.apiUrl,
    wsUrl: store.wsUrl,
    showProgressMessages: store.showProgressMessages,
    showToolCallHistory: store.showToolCallHistory ?? false,
    streamResponses: store.streamResponses ?? true,
    receivePrereleases: store.receivePrereleases ?? false,
    provider: store.runtimeConfig?.runtime?.provider || 'auto',
    model: 'anthropic/claude-sonnet-4-5',
    reasoningEffort: null,
    maxToolIterations: '200',
    restrictToWorkspace: false,
    apiBase: '',
    apiKey: '',
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
  const provider = typeof payload.runtime.provider === 'string' && payload.runtime.provider.trim().length > 0
    ? payload.runtime.provider
    : 'auto'
  const providerSettings = payload.providers[provider]
  const workspacePath = runtimeWorkspacePath(payload)

  return {
    ...draft,
    workspacePath,
    apiUrl: endpoints?.apiUrl ?? draft.apiUrl,
    wsUrl: endpoints?.wsUrl ?? draft.wsUrl,
    provider,
    model: payload.runtime.model,
    reasoningEffort: payload.runtime.reasoning_effort,
    maxToolIterations: String(payload.runtime.max_tool_iterations),
    restrictToWorkspace: payload.runtime.restrict_to_workspace,
    apiBase: providerSettings?.api_base ?? providerSettings?.default_api_base ?? '',
    apiKey: '',
  }
}

function resetWorkspaceScopedState() {
  useAgentStore.getState().resetWorkspaceState()
  useProjectStore.getState().resetWorkspaceState()
}

// Runtime fields a background refresh would otherwise clobber. When the user
// has already edited one (current differs from the seed snapshot taken at
// open), keep their value instead of overwriting it with the late server read.
const PRESERVED_DRAFT_FIELDS = [
  'workspacePath', 'apiUrl', 'wsUrl', 'provider', 'model',
  'reasoningEffort', 'maxToolIterations', 'restrictToWorkspace', 'apiBase', 'apiKey',
] as const

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

function localEngineAlreadyUp(): boolean {
  return useAgentStore.getState().connected
    && useSettingsStore.getState().localEnginePhase === 'ready'
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
  const showEngineWarning = store.engineStatus === 'incompatible' || store.engineStatus === 'unreachable' || store.engineStatus === 'setup_required' || store.localEnginePhase === 'error'

  const [draft, setDraft] = useState<SettingsDraft>(() => createDraft(store))
  const [runtimeProviders, setRuntimeProviders] = useState<RuntimeConfigPayload['providers']>({})
  const [busy, setBusy] = useState(false)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('connection')
  const [workspaceEdited, setWorkspaceEdited] = useState(false)

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

      // Re-bootstrapping re-resolves and re-hashes the bundled engine on every
      // open, which is the main source of the "Settings is slow" lag. When the
      // engine is already running and connected we can skip straight to the
      // (cheap) config fetch.
      if (mode === 'localBundle' && !localEngineAlreadyUp()) {
        const localState = await bootstrapLocalEngine()
        if (localState) {
          store.setLocalEngineBootstrap({
            phase: localState.phase,
            message: localState.message,
            executablePath: localState.executablePath,
            version: localState.version,
            operation: localState.operation,
          })
          if (localState.phase !== 'ready') {
            throw new Error(localState.message)
          }
        }
      }

      const payload = await fetchRuntimeConfig(targetApiUrl)
      if (loadTokenRef.current !== token) return
      if (commitToStore) {
        store.setRuntimeConfig(payload)
        store.setRuntimeConfigLoaded(true)
        store.setRuntimeConfigError(null)
      }
      setRuntimeProviders(payload.providers)
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
    setActiveTab('connection')
    setBusy(false)
    setRuntimeLoading(false)
    setFeedbackError(false)
    setFeedback(null)
    setWorkspaceEdited(false)
    setRuntimeProviders(store.runtimeConfig?.providers ?? {})
    void loadRuntimeConfig(store.deploymentMode, store.apiUrl, true, true)
  }, [settingsOpen])

  useEffect(() => {
    if (draft.deploymentMode !== 'localBundle' && activeTab === 'localEngine') {
      setActiveTab('connection')
    }
  }, [activeTab, draft.deploymentMode])

  if (!settingsOpen) return null

  const handleSwitchMode = (mode: DeploymentMode) => {
    const storedRemote = mode === 'remoteManual'
      ? latestStoredProfile(store.engineProfiles, 'remoteManual')
      : null
    if (storedRemote?.runtimeConfig) {
      setRuntimeProviders(storedRemote.runtimeConfig.providers)
    }
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
          : storedRemote?.apiUrl ?? (current.apiUrl === LOCAL_API_URL ? remoteApiFallback() : current.apiUrl),
        wsUrl: mode === 'localBundle'
          ? LOCAL_WS_URL
          : storedRemote?.wsUrl ?? (current.wsUrl === LOCAL_WS_URL ? remoteWsFallback() : current.wsUrl),
        workspacePath: storedRemote?.workspacePath ?? base.workspacePath,
      }
    })
    if (mode !== 'localBundle') {
      setActiveTab('connection')
    }
    if (mode === 'localBundle') {
      void loadRuntimeConfig(mode, LOCAL_API_URL, false)
    }
    setWorkspaceEdited(false)
  }

  const handleProviderChange = (provider: string) => {
    const snapshot = runtimeProviders[provider]
    setDraft((current) => ({
      ...current,
      provider,
      apiBase: snapshot?.api_base ?? snapshot?.default_api_base ?? '',
      apiKey: '',
    }))
  }

  const handleSave = async () => {
    const nextApiUrl = draft.apiUrl.trim()
    const nextWsUrl = draft.wsUrl.trim()
    const nextWorkspacePath = draft.workspacePath.trim()
    const previousApiUrl = store.apiUrl
    const previousWsUrl = store.wsUrl
    const previousWorkspacePath = store.workspacePath
    const effectiveWorkspacePath = customProjectDirsAllowed
      ? nextWorkspacePath
      : (store.runtimeConfig?.projects_root ?? previousWorkspacePath)
    setBusy(true)
    setFeedback(null)
    setFeedbackError(false)

    try {
      store.setTheme(draft.theme)
      store.setLanguage(draft.language)
      store.setShowProgressMessages(draft.showProgressMessages)
      store.setShowToolCallHistory(draft.showToolCallHistory)
      store.setStreamResponses(draft.streamResponses)
      store.setReceivePrereleases(draft.receivePrereleases)

      if (draft.deploymentMode === 'localBundle') {
        const trimmedModel = draft.model.trim()
        const trimmedApiBase = draft.apiBase.trim()
        const trimmedApiKey = draft.apiKey.trim()
        const providerSnapshot = runtimeProviders[draft.provider]
        const providerName = providerLabel(draft.provider, runtimeProviders)

        if (!trimmedModel) {
          throw new Error(t('settingsRequiresModel', curLang))
        }
        if (providerSnapshot?.api_base_required && !trimmedApiBase) {
          throw new Error(t('settingsProviderRequiresApiBase', curLang, { provider: providerName }))
        }
        if (providerSnapshot?.api_key_required && !trimmedApiKey && !providerSnapshot?.api_key_configured) {
          throw new Error(t('settingsProviderRequiresApiKey', curLang, { provider: providerName }))
        }

        // Skip the (slow) re-bootstrap when the engine is already running and
        // connected — we only need it up to accept the POST below.
        if (!localEngineAlreadyUp()) {
          const localState = await bootstrapLocalEngine()
          if (!localState) {
            throw new Error(t('settingsDesktopBundleUnavailable', curLang))
          }
          store.setLocalEngineBootstrap({
            phase: localState.phase,
            message: localState.message,
            executablePath: localState.executablePath,
            version: localState.version,
            operation: localState.operation,
          })
          if (localState.phase !== 'ready') {
            throw new Error(localState.message)
          }
        }

        store.setDeploymentMode('localBundle')
        store.setConnectionEndpoints(LOCAL_API_URL, LOCAL_WS_URL)
        const providerUpdates = draft.provider === 'auto'
          ? {}
          : {
              [draft.provider]: {
                ...(trimmedApiKey ? { api_key: trimmedApiKey } : {}),
                api_base: trimmedApiBase || null,
              },
            }
        const payload = await saveRuntimeConfig({
          ...(customProjectDirsAllowed ? { projects_root: effectiveWorkspacePath } : {}),
          runtime: {
            ...(customProjectDirsAllowed ? { workspace: effectiveWorkspacePath } : {}),
            provider: draft.provider,
            model: trimmedModel,
            reasoning_effort: draft.reasoningEffort,
            max_tool_iterations: Number(draft.maxToolIterations),
            restrict_to_workspace: draft.restrictToWorkspace,
          },
          providers: providerUpdates,
        })

        const localWorkspaceChanged = workspacePathChanged(previousWorkspacePath, runtimeWorkspacePath(payload))
        if (localWorkspaceChanged) {
          resetWorkspaceScopedState()
        }
        store.setRuntimeConfig(payload)
        store.setRuntimeConfigLoaded(true)
        store.setRuntimeConfigError(null)
        setRuntimeProviders(payload.providers)
        setWorkspaceEdited(false)
        setDraft((current) => applyRuntimePayload(current, payload, {
          apiUrl: LOCAL_API_URL,
          wsUrl: LOCAL_WS_URL,
        }))

        const probe = await probeEngineCompatibility(LOCAL_API_URL)
        store.setEngineBootstrap({
          status: probe.status,
          message: probe.status === 'compatible' ? null : probe.message,
          version: probe.version,
          uptimeSeconds: probe.uptimeSeconds,
        })
        // The project list only changes when the workspace root moves; skip the
        // expensive per-project plan/contract refetch otherwise.
        if (localWorkspaceChanged) {
          await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
        }
      } else {
        if (!nextApiUrl || !nextWsUrl) {
          throw new Error(t('settingsRemoteRequiresUrls', curLang))
        }
        const switchedEngine = store.deploymentMode !== 'remoteManual'
          || endpointChanged(previousApiUrl, previousWsUrl, nextApiUrl, nextWsUrl)

        let payload = await fetchRuntimeConfig(nextApiUrl)
        const remoteCustomProjectDirsAllowed = payload.project_location?.custom_dir_allowed ?? true
        const engineWorkspacePath = runtimeWorkspacePath(payload)
        const shouldUpdateWorkspace = remoteCustomProjectDirsAllowed
          && workspaceEdited
          && workspacePathChanged(engineWorkspacePath, nextWorkspacePath)
        if (shouldUpdateWorkspace) {
          payload = await updateProjectsRoot(nextWorkspacePath, nextApiUrl)
        }

        const resolvedWorkspacePath = runtimeWorkspacePath(payload)
        const remoteWorkspaceChanged = switchedEngine || workspacePathChanged(previousWorkspacePath, resolvedWorkspacePath)
        if (remoteWorkspaceChanged) {
          resetWorkspaceScopedState()
        }
        store.setDeploymentMode('remoteManual')
        store.setConnectionEndpoints(nextApiUrl, nextWsUrl)
        store.setRuntimeConfig(payload)
        store.setRuntimeConfigLoaded(true)
        store.setRuntimeConfigError(null)
        setRuntimeProviders(payload.providers)
        setWorkspaceEdited(false)
        setDraft((current) => applyRuntimePayload(current, payload, {
          apiUrl: nextApiUrl,
          wsUrl: nextWsUrl,
        }))

        const probe = await probeEngineCompatibility(nextApiUrl)
        store.setEngineBootstrap({
          status: probe.status,
          message: probe.status === 'compatible' ? null : probe.message,
          version: probe.version,
          uptimeSeconds: probe.uptimeSeconds,
        })
        if (remoteWorkspaceChanged) {
          await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })
        }
      }

      closeSettings()
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleRestartEngine = async () => {
    setBusy(true)
    setFeedbackError(false)
    setFeedback('Restarting local engine...')
    try {
      await stopLocalEngine()
      await startLocalEngine()
      const localState = await bootstrapLocalEngine()
      if (localState) {
        store.setLocalEngineBootstrap({
          phase: localState.phase,
          message: localState.message,
          executablePath: localState.executablePath,
          version: localState.version,
          operation: localState.operation,
        })
      }
      const probe = await probeEngineCompatibility(LOCAL_API_URL)
      store.setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
        uptimeSeconds: probe.uptimeSeconds,
      })
      setFeedback(probe.status === 'compatible' ? 'Local engine restarted and verified.' : probe.message)
      setFeedbackError(probe.status !== 'compatible')
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleRepairEngine = async () => {
    setBusy(true)
    setFeedbackError(false)
    setFeedback('Repairing local engine service...')
    try {
      const localState = await repairLocalEngineService()
      if (!localState) {
        throw new Error('Desktop engine manager is unavailable.')
      }
      store.setLocalEngineBootstrap({
        phase: localState.phase,
        message: localState.message,
        executablePath: localState.executablePath,
        version: localState.version,
        operation: localState.operation,
      })
      const probe = await probeEngineCompatibility(LOCAL_API_URL)
      store.setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
        uptimeSeconds: probe.uptimeSeconds,
      })
      setFeedback(probe.status === 'compatible' ? 'Local engine service repaired and verified.' : probe.message)
      setFeedbackError(probe.status !== 'compatible')
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDoctorEngine = async () => {
    setBusy(true)
    setFeedbackError(false)
    setFeedback('Collecting local engine diagnostics...')
    try {
      const result = await doctorLocalEngine()
      if (!result?.ok) {
        throw new Error(result?.stderr || 'Local engine doctor failed.')
      }
      setFeedback(result.stdout || 'Local engine diagnostics completed.')
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleUpgradeEngine = async () => {
    setBusy(true)
    setFeedbackError(false)
    setFeedback('Upgrading local engine...')
    try {
      const result = await upgradeLocalEngine('mira-engine')
      if (!result?.ok) {
        throw new Error(result?.stderr || 'Local engine upgrade failed.')
      }
      const localState = await bootstrapLocalEngine()
      if (localState) {
        store.setLocalEngineBootstrap({
          phase: localState.phase,
          message: localState.message,
          executablePath: localState.executablePath,
          version: localState.version,
          operation: localState.operation,
        })
      }
      const probe = await probeEngineCompatibility(LOCAL_API_URL)
      store.setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
        uptimeSeconds: probe.uptimeSeconds,
      })
      if (probe.status !== 'compatible') {
        throw new Error(probe.message)
      }
      setFeedback('Local engine upgraded and verified.')
    } catch (error) {
      setFeedbackError(true)
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const selectedProvider = runtimeProviders[draft.provider]
  const providerOptions = buildProviderOptions(runtimeProviders, draft.provider)
  const localMode = draft.deploymentMode === 'localBundle'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />
      <div className="relative w-[620px] max-h-[84vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {t('settings', curLang)}
          </h2>
          <button
            onClick={closeSettings}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="border-b border-[var(--color-border)] px-6">
          <div className="flex items-end gap-6" role="tablist" aria-label="Settings sections">
            <SettingsTabButton
              label={t('general', curLang)}
              active={activeTab === 'connection'}
              onClick={() => setActiveTab('connection')}
            />
              <SettingsTabButton
              label="Local Engine"
              active={activeTab === 'localEngine'}
              disabled={!localMode}
              onClick={() => setActiveTab('localEngine')}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {activeTab === 'connection' ? (
            <div role="tabpanel" aria-label={t('general', curLang)} className="space-y-6">
              <Section title="Deployment">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">Deployment Mode</p>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                        {localMode
                          ? 'Bundle mode keeps MIRA and mira-engine on this machine, and starts the local engine automatically.'
                          : 'Remote mode only connects to an already-deployed mira endpoint. Install mira separately on the remote server.'}
                      </p>
                    </div>
                    <DeploymentModeSwitch mode={draft.deploymentMode} onChange={handleSwitchMode} />
                  </div>
                </div>
              </Section>

              <Section title={t('workspace', curLang)}>
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
              </Section>

              <AppUpdatesSection
                lang={curLang}
                receivePrereleases={draft.receivePrereleases}
                setReceivePrereleases={(receivePrereleases) => setDraft((current) => ({ ...current, receivePrereleases }))}
              />

              {!localMode && (
                <Section title={t('connection', curLang)}>
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
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-2 leading-relaxed">
                    Remote deployment is not bundled. Install `mira` on your remote server separately, then enter its API and WebSocket endpoints here.
                  </p>
                  <div className="mt-3">
                    <ActionButton
                      disabled={busy || runtimeLoading || !draft.apiUrl.trim()}
                      onClick={() => void loadRuntimeConfig('remoteManual', draft.apiUrl, false)}
                    >
                      {runtimeLoading ? 'Refreshing...' : 'Refresh from engine'}
                    </ActionButton>
                  </div>
                </Section>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Local Engine" className="space-y-6">
              <Section title="Local Engine">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-3 space-y-1">
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
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton disabled={busy} onClick={handleRepairEngine}>
                    Repair service
                  </ActionButton>
                  <ActionButton disabled={busy} onClick={handleRestartEngine}>
                    Restart local engine
                  </ActionButton>
                  <ActionButton disabled={busy} onClick={handleDoctorEngine}>
                    Run doctor
                  </ActionButton>
                  <ActionButton disabled={busy} onClick={handleUpgradeEngine}>
                    Upgrade local engine
                  </ActionButton>
                  <ActionButton disabled={busy || runtimeLoading} onClick={() => void loadRuntimeConfig('localBundle', LOCAL_API_URL, true)}>
                    {runtimeLoading ? 'Refreshing...' : 'Refresh config'}
                  </ActionButton>
                </div>
              </Section>

              <Section title="Local Runtime Config">
                <Label text="Provider" />
                <select
                  value={draft.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className={selectClass}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>

                <Label text="Model" className="mt-3" />
                <input
                  value={draft.model}
                  onChange={(e) => setDraft((current) => ({ ...current, model: e.target.value }))}
                  className={inputClass}
                  placeholder="anthropic/claude-sonnet-4-5"
                />

                <Label text="API Base" className="mt-3" />
                <input
                  value={draft.apiBase}
                  onChange={(e) => setDraft((current) => ({ ...current, apiBase: e.target.value }))}
                  className={inputClass}
                  placeholder={
                    selectedProvider?.default_api_base
                      ? t('settingsLeaveEmptyUseDefault', curLang, { apiBase: selectedProvider.default_api_base })
                      : t('settingsLeaveEmptyProviderDefaults', curLang)
                  }
                />
                {selectedProvider?.api_base_required && (
                  <p className="text-[11px] text-amber-300 mt-1">
                    {t('settingsProviderNeedsApiBaseHint', curLang, { provider: selectedProvider.display_name })}
                  </p>
                )}

                {draft.provider !== 'auto' && !selectedProvider?.is_oauth && (
                  <>
                    <Label text="API Key" className="mt-3" />
                    <input
                      type="password"
                      value={draft.apiKey}
                      onChange={(e) => setDraft((current) => ({ ...current, apiKey: e.target.value }))}
                      className={inputClass}
                      placeholder={selectedProvider?.api_key_configured ? t('settingsLeaveBlankKeepKey', curLang) : t('settingsPasteProviderKey', curLang)}
                    />
                    {selectedProvider?.api_key_required && (
                      <p className="text-[11px] text-amber-300 mt-1">
                        {t('settingsProviderNeedsApiKeyHint', curLang, { provider: selectedProvider.display_name })}
                      </p>
                    )}
                    {selectedProvider?.api_key_preview && (
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                        Saved key preview: {selectedProvider.api_key_preview}
                      </p>
                    )}
                  </>
                )}
                {draft.provider === 'auto' && (
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-3">
                    {t('settingsAutoDetectHint', curLang)}
                  </p>
                )}
                {selectedProvider?.is_oauth && (
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-3">
                    {t('settingsOauthHint', curLang, { provider: selectedProvider.display_name })}
                  </p>
                )}

                <Label text="Reasoning Effort" className="mt-3" />
                <select
                  value={draft.reasoningEffort ?? ''}
                  onChange={(e) => setDraft((current) => ({
                    ...current,
                    reasoningEffort: e.target.value ? e.target.value as Exclude<ReasoningEffort, null> : null,
                  }))}
                  className={selectClass}
                >
                  <option value="">Disabled</option>
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <Label text="Max Tool Iterations" className="mt-3" />
                <input
                  value={draft.maxToolIterations}
                  onChange={(e) => setDraft((current) => ({ ...current, maxToolIterations: e.target.value }))}
                  className={inputClass}
                  inputMode="numeric"
                />

                <ToggleRow
                  className="mt-4"
                  label="Restrict tool access to workspace"
                  checked={draft.restrictToWorkspace}
                  onToggle={() => setDraft((current) => ({ ...current, restrictToWorkspace: !current.restrictToWorkspace }))}
                />
                {store.runtimeConfig?.config_path && (
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-3 break-all">
                    Runtime config path: {store.runtimeConfig.config_path}
                  </p>
                )}
              </Section>
            </div>
          )}

          {feedback && (
            <p className={cn('text-xs leading-relaxed', feedbackError ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
              {feedback}
            </p>
          )}

          <FeedbackSection lang={curLang} onClose={closeSettings} />
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={closeSettings}
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

function SettingsTabButton(
  { label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void },
) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative -mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-transparent text-[var(--color-text-secondary)]',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)]',
      )}
    >
      {label}
    </button>
  )
}

function DeploymentModeSwitch(
  { mode, onChange }: { mode: DeploymentMode; onChange: (mode: DeploymentMode) => void },
) {
  const local = mode === 'localBundle'

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span className={cn('text-xs font-medium transition-colors', local ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
        Local
      </span>
      <button
        type="button"
        role="switch"
        aria-label="Deployment mode"
        aria-checked={!local}
        onClick={() => onChange(local ? 'remoteManual' : 'localBundle')}
        className={cn(
          'inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors',
          local ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]',
        )}
      >
        <span
          className={cn(
            'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
            local ? 'translate-x-0' : 'translate-x-5',
          )}
        />
      </button>
      <span className={cn('text-xs font-medium transition-colors', !local ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
        Remote
      </span>
    </div>
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

const selectClass = inputClass

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
