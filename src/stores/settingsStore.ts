import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export type Language = 'en' | 'zh'

interface SettingsState {
  workspacePath: string
  theme: Theme
  language: Language
  apiUrl: string
  wsUrl: string
  settingsOpen: boolean

  setWorkspacePath: (p: string) => void
  setTheme: (t: Theme) => void
  setLanguage: (l: Language) => void
  setApiUrl: (u: string) => void
  setWsUrl: (u: string) => void
  openSettings: () => void
  closeSettings: () => void
}

const STORAGE_KEY = 'sci-agent-ui-settings'

function loadPersisted(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function persist(state: SettingsState) {
  const { workspacePath, theme, language, apiUrl, wsUrl } = state
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspacePath, theme, language, apiUrl, wsUrl }))
}

const saved = loadPersisted()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: saved.workspacePath ?? '~/.radiologybot/workspace',
  theme: (saved.theme as Theme) ?? 'dark',
  language: (saved.language as Language) ?? 'en',
  apiUrl: saved.apiUrl ?? 'http://localhost:18790/api',
  wsUrl: saved.wsUrl ?? 'ws://localhost:18790/ws',
  settingsOpen: false,

  setWorkspacePath: (p) => { set({ workspacePath: p }); persist(get()) },
  setTheme: (t) => { set({ theme: t }); persist(get()); applyTheme(t) },
  setLanguage: (l) => { set({ language: l }); persist(get()) },
  setApiUrl: (u) => { set({ apiUrl: u }); persist(get()) },
  setWsUrl: (u) => { set({ wsUrl: u }); persist(get()) },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply persisted theme on load
applyTheme(useSettingsStore.getState().theme)
