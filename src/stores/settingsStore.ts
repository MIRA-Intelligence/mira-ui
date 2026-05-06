import { create } from 'zustand'
import type { LocalEnginePhase } from '@/services/desktop'
import type { RuntimeConfigPayload } from '@/services/runtimeConfig'

export type Theme = 'dark' | 'light'
export type Language = 'en' | 'zh'
export type EngineStatus = 'unknown' | 'compatible' | 'incompatible' | 'unreachable' | 'setup_required'
export type DeploymentMode = 'localBundle' | 'remoteManual'

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
  workspacePath: string
  theme: Theme
  language: Language
  deploymentMode: DeploymentMode
  apiUrl: string
  wsUrl: string
  showProgressMessages: boolean
  showToolCallHistory: boolean
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
    theme,
    language,
    deploymentMode,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
    receivePrereleases,
  } = state
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    workspacePath,
    theme,
    language,
    deploymentMode,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: saved.workspacePath ?? DEFAULT_WORKSPACE_PATH,
  theme: (saved.theme as Theme) ?? 'dark',
  language: (saved.language as Language) ?? 'en',
  deploymentMode: initialDeploymentMode,
  apiUrl: initialApiUrl,
  wsUrl: initialWsUrl,
  showProgressMessages: saved.showProgressMessages ?? true,
  showToolCallHistory: saved.showToolCallHistory ?? true,
  receivePrereleases: saved.receivePrereleases ?? false,
  settingsOpen: false,
  engineStatus: 'unknown',
  engineMessage: null,
  engineVersion: null,
  connectionMessage: null,
  localEnginePhase: 'idle',
  localEngineExecutablePath: null,
  runtimeConfig: null,
  runtimeConfigLoaded: false,
  runtimeConfigError: null,

  setWorkspacePath: (p) => { set({ workspacePath: p }); persist(get()) },
  setTheme: (t) => { set({ theme: t }); persist(get()); applyTheme(t) },
  setLanguage: (l) => { set({ language: l }); persist(get()) },
  setDeploymentMode: (mode) => {
    set((state) => {
      if (state.deploymentMode === mode) {
        return state
      }
      if (mode === 'localBundle') {
        return {
          deploymentMode: mode,
          apiUrl: localApiUrl(),
          wsUrl: localWsUrl(),
        }
      }
      return {
        deploymentMode: mode,
        apiUrl: state.apiUrl,
        wsUrl: state.wsUrl,
      }
    })
    persist(get())
  },
  setApiUrl: (u) => { set({ apiUrl: u }); persist(get()) },
  setWsUrl: (u) => { set({ wsUrl: u }); persist(get()) },
  setConnectionEndpoints: (apiUrl, wsUrl) => {
    set((state) => (
      state.apiUrl === apiUrl && state.wsUrl === wsUrl
        ? state
        : { apiUrl, wsUrl }
    ))
    persist(get())
  },
  setShowProgressMessages: (v) => { set({ showProgressMessages: v }); persist(get()) },
  setShowToolCallHistory: (v) => { set({ showToolCallHistory: v }); persist(get()) },
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
      return { engineStatus: status, engineMessage: message, engineVersion: nextVersion }
    })
  },
  setConnectionMessage: (message) => set((state) => (
    state.connectionMessage === message ? state : { connectionMessage: message }
  )),
  setLocalEngineBootstrap: ({ phase, message, executablePath, version }) => {
    set((state) => ({
      localEnginePhase: phase,
      localEngineExecutablePath: executablePath ?? state.localEngineExecutablePath,
      engineMessage: message ?? state.engineMessage,
      engineVersion: version ?? state.engineVersion,
    }))
  },
  setRuntimeConfig: (payload) => set({ runtimeConfig: payload }),
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
