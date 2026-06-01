import { create } from 'zustand'
import type { LocalEngineOperation, LocalEnginePhase } from '@/services/desktop'
import type { RuntimeConfigPayload } from '@/services/runtimeConfig'

export type Theme = 'dark' | 'light'
export type Language = 'en' | 'zh'
export type EngineStatus = 'unknown' | 'compatible' | 'incompatible' | 'unreachable' | 'setup_required'
export type DeploymentMode = 'localBundle' | 'remoteManual'

export interface EngineProfile {
  key: string
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  workspacePath: string
  runtimeConfig: RuntimeConfigPayload | null
  engineVersion: string | null
  configPath: string | null
  updatedAt: number
}

const GATEWAY_PORT = 18790
const DEFAULT_WORKSPACE_PATH = '~/.mira/workspace'
const LOCAL_ENGINE_HOST = '127.0.0.1'

function localApiUrl(): string {
  return `http://${LOCAL_ENGINE_HOST}:${GATEWAY_PORT}/api`
}

function localWsUrl(): string {
  return `ws://${LOCAL_ENGINE_HOST}:${GATEWAY_PORT}/ws`
}

function defaultRemoteApiUrl(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  return `http://${host}:${GATEWAY_PORT}/api`
}

function defaultRemoteWsUrl(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${host}:${GATEWAY_PORT}/ws`
}

function defaultDeploymentMode(): DeploymentMode {
  return typeof window !== 'undefined' && window.electronAPI ? 'localBundle' : 'remoteManual'
}

interface SettingsState {
  activeEngineKey: string
  engineProfiles: Record<string, EngineProfile>
  workspacePath: string
  theme: Theme
  language: Language
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  showProgressMessages: boolean
  showToolCallHistory: boolean
  // Stream assistant replies token-by-token. Default on for responsiveness.
  streamResponses: boolean
  // Opt-in: when true, the auto-update check considers prereleases (rcN /
  // betaN) alongside stable releases. Defaults to false so casual users only
  // see ".0" upgrades.
  receivePrereleases: boolean
  settingsOpen: boolean
  engineStatus: EngineStatus
  engineMessage: string | null
  engineVersion: string | null
  connectionMessage: string | null
  localEnginePhase: LocalEnginePhase
  localEngineOperation: LocalEngineOperation
  localEngineExecutablePath: string | null
  runtimeConfig: RuntimeConfigPayload | null
  runtimeConfigLoaded: boolean
  runtimeConfigError: string | null

  setWorkspacePath: (p: string) => void
  setTheme: (t: Theme) => void
  setLanguage: (l: Language) => void
  setDeploymentMode: (mode: DeploymentMode) => void
  setApiUrl: (u: string) => void
  setWsUrl: (u: string) => void
  setConnectionEndpoints: (apiUrl: string, wsUrl: string) => void
  setShowProgressMessages: (v: boolean) => void
  setShowToolCallHistory: (v: boolean) => void
  setStreamResponses: (v: boolean) => void
  setReceivePrereleases: (v: boolean) => void
  setEngineBootstrap: (payload: {
    status: EngineStatus
    message: string | null
    version?: string | null
  }) => void
  setConnectionMessage: (message: string | null) => void
  setLocalEngineBootstrap: (payload: {
    phase: LocalEnginePhase
    message: string | null
    executablePath?: string | null
    version?: string | null
    operation?: LocalEngineOperation
  }) => void
  setRuntimeConfig: (payload: RuntimeConfigPayload | null) => void
  setRuntimeConfigError: (message: string | null) => void
  setRuntimeConfigLoaded: (loaded: boolean) => void
  openSettings: () => void
  closeSettings: () => void
}

const STORAGE_KEY = 'mira-ui-settings'
const LEGACY_STORAGE_KEY = 'medpilot-ui-settings'

// One-time migration: copy legacy MedPilot settings into the new MIRA key.
function migrateLegacyStorageKey(): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function' || typeof localStorage.setItem !== 'function' || typeof localStorage.removeItem !== 'function') return
    if (localStorage.getItem(STORAGE_KEY)) return
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return
    localStorage.setItem(STORAGE_KEY, legacy)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch { /* ignore */ }
}

migrateLegacyStorageKey()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStaleLocalhost(url: string | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch { return false }
}

function normalizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

function engineProfileKey(mode: DeploymentMode, apiUrl: string): string {
  if (mode === 'localBundle') return 'localBundle'
  return `remote:${normalizeEndpoint(apiUrl)}`
}

function workspaceFromRuntime(payload: RuntimeConfigPayload): string {
  return payload.runtime.workspace || payload.projects_root || DEFAULT_WORKSPACE_PATH
}

function createEngineProfile(input: {
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  workspacePath?: string
  runtimeConfig?: RuntimeConfigPayload | null
  engineVersion?: string | null
  configPath?: string | null
}): EngineProfile {
  const key = engineProfileKey(input.deploymentMode, input.apiUrl)
  const runtimeConfig = input.runtimeConfig ?? null
  return {
    key,
    deploymentMode: input.deploymentMode,
    apiUrl: input.apiUrl,
    wsUrl: input.wsUrl,
    workspacePath: input.workspacePath ?? (runtimeConfig ? workspaceFromRuntime(runtimeConfig) : DEFAULT_WORKSPACE_PATH),
    runtimeConfig,
    engineVersion: input.engineVersion ?? null,
    configPath: input.configPath ?? runtimeConfig?.config_path ?? null,
    updatedAt: Date.now(),
  }
}

function sanitizeEngineProfile(value: unknown): EngineProfile | null {
  if (!isRecord(value)) return null
  const deploymentMode = value.deploymentMode === 'localBundle' || value.deploymentMode === 'remoteManual'
    ? value.deploymentMode
    : null
  const apiUrl = typeof value.apiUrl === 'string' ? value.apiUrl : null
  const wsUrl = typeof value.wsUrl === 'string' ? value.wsUrl : null
  if (!deploymentMode || !apiUrl || !wsUrl) return null

  const runtimeConfig = isRecord(value.runtimeConfig) ? value.runtimeConfig as unknown as RuntimeConfigPayload : null
  const profile = createEngineProfile({
    deploymentMode,
    apiUrl,
    wsUrl,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : undefined,
    runtimeConfig,
    engineVersion: typeof value.engineVersion === 'string' ? value.engineVersion : null,
    configPath: typeof value.configPath === 'string' ? value.configPath : null,
  })
  if (typeof value.key === 'string' && value.key.trim()) {
    profile.key = value.key
  }
  if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) {
    profile.updatedAt = value.updatedAt
  }
  return profile
}

function currentProfileFromState(state: SettingsState): EngineProfile {
  return createEngineProfile({
    deploymentMode: state.deploymentMode,
    apiUrl: state.apiUrl,
    wsUrl: state.wsUrl,
    workspacePath: state.workspacePath,
    runtimeConfig: state.runtimeConfig,
    engineVersion: state.engineVersion,
    configPath: state.runtimeConfig?.config_path ?? null,
  })
}

function profilesWithCurrent(state: SettingsState): Record<string, EngineProfile> {
  const current = currentProfileFromState(state)
  return {
    ...state.engineProfiles,
    [current.key]: current,
  }
}

function selectProfile(
  profiles: Record<string, EngineProfile>,
  mode: DeploymentMode,
  apiUrl: string,
  wsUrl: string,
  fallbackWorkspace = DEFAULT_WORKSPACE_PATH,
): EngineProfile {
  const key = engineProfileKey(mode, apiUrl)
  return profiles[key] ?? createEngineProfile({
    deploymentMode: mode,
    apiUrl,
    wsUrl,
    workspacePath: fallbackWorkspace,
  })
}

function latestProfileForMode(
  profiles: Record<string, EngineProfile>,
  mode: DeploymentMode,
): EngineProfile | null {
  let latest: EngineProfile | null = null
  for (const profile of Object.values(profiles)) {
    if (profile.deploymentMode !== mode) continue
    if (!latest || profile.updatedAt >= latest.updatedAt) {
      latest = profile
    }
  }
  return latest
}

function loadPersisted(): Partial<SettingsState> {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
      return {}
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return {}
    }

    const sanitized: Partial<SettingsState> = {}

    if (typeof parsed.workspacePath === 'string') {
      sanitized.workspacePath = parsed.workspacePath
    }
    if (typeof parsed.activeEngineKey === 'string') {
      sanitized.activeEngineKey = parsed.activeEngineKey
    }
    if (isRecord(parsed.engineProfiles)) {
      const profiles: Record<string, EngineProfile> = {}
      for (const [key, rawProfile] of Object.entries(parsed.engineProfiles)) {
        const profile = sanitizeEngineProfile(rawProfile)
        if (profile) {
          profiles[key] = profile
        }
      }
      sanitized.engineProfiles = profiles
    }
    if (parsed.theme === 'dark' || parsed.theme === 'light') {
      sanitized.theme = parsed.theme
    }
    if (parsed.language === 'en' || parsed.language === 'zh') {
      sanitized.language = parsed.language
    }
    if (parsed.deploymentMode === 'localBundle' || parsed.deploymentMode === 'remoteManual') {
      sanitized.deploymentMode = parsed.deploymentMode
    }

    const apiUrl = typeof parsed.apiUrl === 'string' ? parsed.apiUrl : undefined
    if (apiUrl && !isStaleLocalhost(apiUrl)) {
      sanitized.apiUrl = apiUrl
    }

    const wsUrl = typeof parsed.wsUrl === 'string' ? parsed.wsUrl : undefined
    if (wsUrl && !isStaleLocalhost(wsUrl)) {
      sanitized.wsUrl = wsUrl
    }

    if (typeof parsed.showProgressMessages === 'boolean') {
      sanitized.showProgressMessages = parsed.showProgressMessages
    }
    if (typeof parsed.showToolCallHistory === 'boolean') {
      sanitized.showToolCallHistory = parsed.showToolCallHistory
    }
    if (typeof parsed.streamResponses === 'boolean') {
      sanitized.streamResponses = parsed.streamResponses
    }
    if (typeof parsed.receivePrereleases === 'boolean') {
      sanitized.receivePrereleases = parsed.receivePrereleases
    }

    return sanitized
  } catch { /* ignore */ }
  return {}
}

function persist(state: SettingsState) {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') {
    return
  }
  const {
    workspacePath,
    activeEngineKey,
    theme,
    language,
    deploymentMode,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
    streamResponses,
    receivePrereleases,
  } = state
  const profiles = profilesWithCurrent(state)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeEngineKey,
    engineProfiles: profiles,
    workspacePath,
    theme,
    language,
    deploymentMode,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
    streamResponses,
    receivePrereleases,
  }))
}

const saved = loadPersisted()
const initialDeploymentMode = saved.deploymentMode ?? defaultDeploymentMode()
const initialApiUrl = initialDeploymentMode === 'localBundle'
  ? localApiUrl()
  : saved.apiUrl ?? defaultRemoteApiUrl()
const initialWsUrl = initialDeploymentMode === 'localBundle'
  ? localWsUrl()
  : saved.wsUrl ?? defaultRemoteWsUrl()
const initialEngineProfiles = saved.engineProfiles ?? {}
const initialEngineKey = saved.activeEngineKey ?? engineProfileKey(initialDeploymentMode, initialApiUrl)
const seededInitialProfile = initialEngineProfiles[initialEngineKey]
  ?? createEngineProfile({
    deploymentMode: initialDeploymentMode,
    apiUrl: initialApiUrl,
    wsUrl: initialWsUrl,
    workspacePath: saved.workspacePath ?? DEFAULT_WORKSPACE_PATH,
  })

export const useSettingsStore = create<SettingsState>((set, get) => ({
  activeEngineKey: seededInitialProfile.key,
  engineProfiles: {
    ...initialEngineProfiles,
    [seededInitialProfile.key]: seededInitialProfile,
  },
  workspacePath: seededInitialProfile.workspacePath,
  theme: (saved.theme as Theme) ?? 'dark',
  language: (saved.language as Language) ?? 'en',
  deploymentMode: initialDeploymentMode,
  apiUrl: seededInitialProfile.apiUrl,
  wsUrl: seededInitialProfile.wsUrl,
  showProgressMessages: saved.showProgressMessages ?? true,
  showToolCallHistory: saved.showToolCallHistory ?? true,
  streamResponses: saved.streamResponses ?? true,
  receivePrereleases: saved.receivePrereleases ?? false,
  settingsOpen: false,
  engineStatus: 'unknown',
  engineMessage: null,
  engineVersion: null,
  connectionMessage: null,
  localEnginePhase: 'idle',
  localEngineOperation: null,
  localEngineExecutablePath: null,
  runtimeConfig: seededInitialProfile.runtimeConfig,
  runtimeConfigLoaded: Boolean(seededInitialProfile.runtimeConfig),
  runtimeConfigError: null,

  setWorkspacePath: (p) => {
    set((state) => {
      const profile = createEngineProfile({
        deploymentMode: state.deploymentMode,
        apiUrl: state.apiUrl,
        wsUrl: state.wsUrl,
        workspacePath: p,
        runtimeConfig: state.runtimeConfig,
        engineVersion: state.engineVersion,
      })
      return {
        workspacePath: p,
        engineProfiles: { ...state.engineProfiles, [profile.key]: profile },
      }
    })
    persist(get())
  },
  setTheme: (t) => { set({ theme: t }); persist(get()); applyTheme(t) },
  setLanguage: (l) => { set({ language: l }); persist(get()) },
  setDeploymentMode: (mode) => {
    set((state) => {
      if (state.deploymentMode === mode) {
        return state
      }
      const profiles = profilesWithCurrent(state)
      if (mode === 'localBundle') {
        const profile = selectProfile(profiles, mode, localApiUrl(), localWsUrl())
        return {
          deploymentMode: mode,
          activeEngineKey: profile.key,
          engineProfiles: { ...profiles, [profile.key]: profile },
          apiUrl: profile.apiUrl,
          wsUrl: profile.wsUrl,
          workspacePath: profile.workspacePath,
          runtimeConfig: profile.runtimeConfig,
          runtimeConfigLoaded: Boolean(profile.runtimeConfig),
        }
      }
      const latestRemote = latestProfileForMode(profiles, mode)
      const nextApiUrl = isStaleLocalhost(state.apiUrl)
        ? latestRemote?.apiUrl ?? defaultRemoteApiUrl()
        : state.apiUrl
      const nextWsUrl = isStaleLocalhost(state.wsUrl)
        ? latestRemote?.wsUrl ?? defaultRemoteWsUrl()
        : state.wsUrl
      const profile = profiles[engineProfileKey(mode, nextApiUrl)]
        ?? latestRemote
        ?? selectProfile(profiles, mode, nextApiUrl, nextWsUrl)
      return {
        deploymentMode: mode,
        activeEngineKey: profile.key,
        engineProfiles: { ...profiles, [profile.key]: profile },
        apiUrl: profile.apiUrl,
        wsUrl: profile.wsUrl,
        workspacePath: profile.workspacePath,
        runtimeConfig: profile.runtimeConfig,
        runtimeConfigLoaded: Boolean(profile.runtimeConfig),
      }
    })
    persist(get())
  },
  setApiUrl: (u) => {
    set((state) => {
      const profile = createEngineProfile({
        deploymentMode: state.deploymentMode,
        apiUrl: u,
        wsUrl: state.wsUrl,
        workspacePath: state.workspacePath,
        runtimeConfig: state.runtimeConfig,
        engineVersion: state.engineVersion,
      })
      return {
        apiUrl: u,
        activeEngineKey: profile.key,
        engineProfiles: { ...profilesWithCurrent(state), [profile.key]: profile },
      }
    })
    persist(get())
  },
  setWsUrl: (u) => {
    set((state) => {
      const profile = createEngineProfile({
        deploymentMode: state.deploymentMode,
        apiUrl: state.apiUrl,
        wsUrl: u,
        workspacePath: state.workspacePath,
        runtimeConfig: state.runtimeConfig,
        engineVersion: state.engineVersion,
      })
      return {
        wsUrl: u,
        activeEngineKey: profile.key,
        engineProfiles: { ...profilesWithCurrent(state), [profile.key]: profile },
      }
    })
    persist(get())
  },
  setConnectionEndpoints: (apiUrl, wsUrl) => {
    set((state) => {
      if (state.apiUrl === apiUrl && state.wsUrl === wsUrl) {
        return state
      }
      const profiles = profilesWithCurrent(state)
      const profile = selectProfile(profiles, state.deploymentMode, apiUrl, wsUrl)
      return {
        apiUrl: profile.apiUrl,
        wsUrl: profile.wsUrl,
        activeEngineKey: profile.key,
        workspacePath: profile.workspacePath,
        runtimeConfig: profile.runtimeConfig,
        runtimeConfigLoaded: Boolean(profile.runtimeConfig),
        engineProfiles: { ...profiles, [profile.key]: profile },
      }
    })
    persist(get())
  },
  setShowProgressMessages: (v) => { set({ showProgressMessages: v }); persist(get()) },
  setShowToolCallHistory: (v) => { set({ showToolCallHistory: v }); persist(get()) },
  setStreamResponses: (v) => { set({ streamResponses: v }); persist(get()) },
  setReceivePrereleases: (v) => { set({ receivePrereleases: v }); persist(get()) },
  setEngineBootstrap: ({ status, message, version }) => {
    const nextVersion = version ?? null
    set((state) => {
      if (
        state.engineStatus === status &&
        state.engineMessage === message &&
        state.engineVersion === nextVersion
      ) {
        return state
      }
      const nextState = { ...state, engineStatus: status, engineMessage: message, engineVersion: nextVersion }
      return {
        engineStatus: status,
        engineMessage: message,
        engineVersion: nextVersion,
        engineProfiles: profilesWithCurrent(nextState),
      }
    })
  },
  setConnectionMessage: (message) => set((state) => (
    state.connectionMessage === message ? state : { connectionMessage: message }
  )),
  setLocalEngineBootstrap: ({ phase, message, executablePath, version, operation }) => {
    set((state) => {
      const nextState = {
        ...state,
        localEnginePhase: phase,
        localEngineOperation: operation === undefined ? state.localEngineOperation : operation,
        localEngineExecutablePath: executablePath ?? state.localEngineExecutablePath,
        engineMessage: message ?? state.engineMessage,
        engineVersion: version ?? state.engineVersion,
      }
      return {
        localEnginePhase: nextState.localEnginePhase,
        localEngineOperation: nextState.localEngineOperation,
        localEngineExecutablePath: nextState.localEngineExecutablePath,
        engineMessage: nextState.engineMessage,
        engineVersion: nextState.engineVersion,
        engineProfiles: profilesWithCurrent(nextState),
      }
    })
  },
  setRuntimeConfig: (payload) => {
    set((state) => {
      if (!payload) {
        const nextState = { ...state, runtimeConfig: null }
        return {
          runtimeConfig: null,
          engineProfiles: profilesWithCurrent(nextState),
        }
      }
      const workspacePath = workspaceFromRuntime(payload)
      const profile = createEngineProfile({
        deploymentMode: state.deploymentMode,
        apiUrl: state.apiUrl,
        wsUrl: state.wsUrl,
        workspacePath,
        runtimeConfig: payload,
        engineVersion: state.engineVersion,
        configPath: payload.config_path,
      })
      return {
        runtimeConfig: payload,
        workspacePath,
        activeEngineKey: profile.key,
        engineProfiles: { ...state.engineProfiles, [profile.key]: profile },
      }
    })
    persist(get())
  },
  setRuntimeConfigError: (message) => set({ runtimeConfigError: message }),
  setRuntimeConfigLoaded: (loaded) => set({ runtimeConfigLoaded: loaded }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply persisted theme on load
applyTheme(useSettingsStore.getState().theme)
