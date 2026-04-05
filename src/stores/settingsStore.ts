import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export type Language = 'en' | 'zh'
export type EngineStatus = 'unknown' | 'compatible' | 'incompatible' | 'unreachable'

const GATEWAY_PORT = 18790
const DEFAULT_WORKSPACE_PATH = '~/.medpilot/workspace'

function defaultApiUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${host}:${GATEWAY_PORT}/api`
}

function defaultWsUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
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
  settingsOpen: boolean
  engineStatus: EngineStatus
  engineMessage: string | null
  engineVersion: string | null

  setWorkspacePath: (p: string) => void
  setTheme: (t: Theme) => void
  setLanguage: (l: Language) => void
  setApiUrl: (u: string) => void
  setWsUrl: (u: string) => void
  setShowProgressMessages: (v: boolean) => void
  setEngineBootstrap: (payload: {
    status: EngineStatus
    message: string | null
    version?: string | null
  }) => void
  openSettings: () => void
  closeSettings: () => void
}

const STORAGE_KEY = 'medpilot-ui-settings'

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
    if (isStaleLocalhost(parsed.apiUrl)) {
      delete parsed.apiUrl
    }
    if (isStaleLocalhost(parsed.wsUrl)) {
      delete parsed.wsUrl
    }
    return parsed
  } catch { /* ignore */ }
  return {}
}

function persist(state: SettingsState) {
  const { workspacePath, theme, language, apiUrl, wsUrl, showProgressMessages } = state
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    workspacePath,
    theme,
    language,
    apiUrl,
    wsUrl,
    showProgressMessages,
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
  settingsOpen: false,
  engineStatus: 'unknown',
  engineMessage: null,
  engineVersion: null,

  setWorkspacePath: (p) => { set({ workspacePath: p }); persist(get()) },
  setTheme: (t) => { set({ theme: t }); persist(get()); applyTheme(t) },
  setLanguage: (l) => { set({ language: l }); persist(get()) },
  setApiUrl: (u) => { set({ apiUrl: u }); persist(get()) },
  setWsUrl: (u) => { set({ wsUrl: u }); persist(get()) },
  setShowProgressMessages: (v) => { set({ showProgressMessages: v }); persist(get()) },
  setEngineBootstrap: ({ status, message, version }) => {
    set({ engineStatus: status, engineMessage: message, engineVersion: version ?? null })
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply persisted theme on load
applyTheme(useSettingsStore.getState().theme)
