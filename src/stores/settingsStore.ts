import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export type Language = 'en' | 'zh'
export type EngineStatus = 'unknown' | 'compatible' | 'incompatible' | 'unreachable'

const GATEWAY_PORT = 18790
const DEFAULT_WORKSPACE_PATH = '~/.mira/workspace'

function defaultApiUrl(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  return `http://${host}:${GATEWAY_PORT}/api`
}

function defaultWsUrl(): string {
  const rawHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const host = rawHost && rawHost.trim().length > 0 ? rawHost : '127.0.0.1'
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${host}:${GATEWAY_PORT}/ws`
}

interface SettingsState {
  workspacePath: string
  theme: Theme
  language: Language
  apiUrl: string
  wsUrl: string
  showProgressMessages: boolean
  showToolCallHistory: boolean
  settingsOpen: boolean
  engineStatus: EngineStatus
  engineMessage: string | null
  engineVersion: string | null

  setWorkspacePath: (p: string) => void
  setTheme: (t: Theme) => void
  setLanguage: (l: Language) => void
  setApiUrl: (u: string) => void
  setWsUrl: (u: string) => void
  setConnectionEndpoints: (apiUrl: string, wsUrl: string) => void
  setShowProgressMessages: (v: boolean) => void
  setShowToolCallHistory: (v: boolean) => void
  setEngineBootstrap: (payload: {
    status: EngineStatus
    message: string | null
    version?: string | null
  }) => void
  openSettings: () => void
  closeSettings: () => void
}

const STORAGE_KEY = 'mira-ui-settings'
const LEGACY_STORAGE_KEY = 'medpilot-ui-settings'

// One-time migration: copy legacy MedPilot settings into the new MIRA key.
function migrateLegacyStorageKey(): void {
  try {
    if (typeof localStorage === 'undefined') return
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

    return sanitized
  } catch { /* ignore */ }
  return {}
}

function persist(state: SettingsState) {
  const {
    workspacePath,
    theme,
    language,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
  } = state
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    workspacePath,
    theme,
    language,
    apiUrl,
    wsUrl,
    showProgressMessages,
    showToolCallHistory,
  }))
}

const saved = loadPersisted()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: saved.workspacePath ?? DEFAULT_WORKSPACE_PATH,
  theme: (saved.theme as Theme) ?? 'dark',
  language: (saved.language as Language) ?? 'en',
  apiUrl: saved.apiUrl ?? defaultApiUrl(),
  wsUrl: saved.wsUrl ?? defaultWsUrl(),
  showProgressMessages: saved.showProgressMessages ?? true,
  showToolCallHistory: saved.showToolCallHistory ?? true,
  settingsOpen: false,
  engineStatus: 'unknown',
  engineMessage: null,
  engineVersion: null,

  setWorkspacePath: (p) => { set({ workspacePath: p }); persist(get()) },
  setTheme: (t) => { set({ theme: t }); persist(get()); applyTheme(t) },
  setLanguage: (l) => { set({ language: l }); persist(get()) },
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
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply persisted theme on load
applyTheme(useSettingsStore.getState().theme)
