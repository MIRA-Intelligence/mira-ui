import { create } from 'zustand'

export type SystemMessageSeverity = 'info' | 'success' | 'warning' | 'error'

export interface SystemMessage {
  id: string
  text: string
  severity: SystemMessageSeverity
  expiresAt: number
}

interface PushSystemMessageOptions {
  severity?: SystemMessageSeverity
  ttlMs?: number
}

const DEFAULT_SYSTEM_MESSAGE_TTL_MS = 4000
const MAX_SYSTEM_MESSAGES = 16

// Resizable panel bounds (px). Widths persist per browser via localStorage.
export const SIDEBAR_WIDTH = { min: 160, max: 400, default: 220 } as const
export const AGENT_PANEL_WIDTH = { min: 360, max: 960, default: 560 } as const

const SIDEBAR_WIDTH_KEY = 'mira:ui:sidebarWidth'
const AGENT_PANEL_WIDTH_KEY = 'mira:ui:agentPanelWidth'

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function loadWidth(key: string, bounds: { min: number; max: number; default: number }): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return bounds.default
    return clamp(Number(raw), bounds.min, bounds.max)
  } catch {
    return bounds.default
  }
}

function saveWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Ignore — non-persisted width is acceptable (e.g. private mode).
  }
}

export interface OpenNewProjectOptions {
  // Seed the description field (e.g. when promoting a Quick Chat into a project).
  prefill?: string
  // When set, the originating chat thread is removed once the project is created.
  fromChatId?: string
}

interface UiState {
  sidebarCollapsed: boolean
  agentPanelCollapsed: boolean
  sidebarWidth: number
  agentPanelWidth: number
  newProjectOpen: boolean
  newProjectPrefill: string | null
  newProjectFromChatId: string | null
  skillsPluginsOpen: boolean
  communityOpen: boolean
  // Set by useUpdateCheck when the main process detects a newer GitHub
  // release. Cleared by "Skip this version" / "Later". Transient — never
  // persisted; main process is the source of truth on every boot.
  availableUpdate: UpdateInfo | null
  // Session-only dismiss; reset on app restart. Distinct from "skip this
  // version" which persists in the userData JSON file.
  updateBannerDismissed: boolean
  systemMessages: SystemMessage[]
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setSidebarWidth: (px: number) => void
  toggleAgentPanel: () => void
  setAgentPanelCollapsed: (v: boolean) => void
  setAgentPanelWidth: (px: number) => void
  openNewProject: (options?: OpenNewProjectOptions) => void
  closeNewProject: () => void
  openSkillsPlugins: () => void
  closeSkillsPlugins: () => void
  openCommunity: () => void
  closeCommunity: () => void
  setAvailableUpdate: (info: UpdateInfo | null) => void
  dismissUpdateBanner: () => void
  resetUpdateBannerDismissed: () => void
  pushSystemMessage: (text: string, options?: PushSystemMessageOptions) => string
  dismissSystemMessage: (id: string) => void
  clearExpiredSystemMessages: (now?: number) => void
}

let systemMessageCounter = 0
function nextSystemMessageId(): string {
  systemMessageCounter += 1
  return `sysmsg-${Date.now().toString(36)}-${systemMessageCounter}`
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  agentPanelCollapsed: false,
  sidebarWidth: loadWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH),
  agentPanelWidth: loadWidth(AGENT_PANEL_WIDTH_KEY, AGENT_PANEL_WIDTH),
  newProjectOpen: false,
  newProjectPrefill: null,
  newProjectFromChatId: null,
  skillsPluginsOpen: false,
  communityOpen: false,
  availableUpdate: null,
  updateBannerDismissed: false,
  systemMessages: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setSidebarWidth: (px) => {
    const w = clamp(px, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
    saveWidth(SIDEBAR_WIDTH_KEY, w)
    set({ sidebarWidth: w })
  },
  toggleAgentPanel: () => set((s) => ({ agentPanelCollapsed: !s.agentPanelCollapsed })),
  setAgentPanelCollapsed: (v) => set({ agentPanelCollapsed: v }),
  setAgentPanelWidth: (px) => {
    const w = clamp(px, AGENT_PANEL_WIDTH.min, AGENT_PANEL_WIDTH.max)
    saveWidth(AGENT_PANEL_WIDTH_KEY, w)
    set({ agentPanelWidth: w })
  },
  openNewProject: (options) =>
    set({
      newProjectOpen: true,
      newProjectPrefill: options?.prefill ?? null,
      newProjectFromChatId: options?.fromChatId ?? null,
    }),
  closeNewProject: () =>
    set({ newProjectOpen: false, newProjectPrefill: null, newProjectFromChatId: null }),
  openSkillsPlugins: () => set({ skillsPluginsOpen: true }),
  closeSkillsPlugins: () => set({ skillsPluginsOpen: false }),
  openCommunity: () => set({ communityOpen: true }),
  closeCommunity: () => set({ communityOpen: false }),
  setAvailableUpdate: (info) => set({ availableUpdate: info, updateBannerDismissed: false }),
  dismissUpdateBanner: () => set({ updateBannerDismissed: true }),
  resetUpdateBannerDismissed: () => set({ updateBannerDismissed: false }),
  pushSystemMessage: (text, options) => {
    const id = nextSystemMessageId()
    const severity = options?.severity ?? 'info'
    const ttlMs = Math.max(500, options?.ttlMs ?? DEFAULT_SYSTEM_MESSAGE_TTL_MS)
    const expiresAt = Date.now() + ttlMs
    set((s) => {
      const next = [...s.systemMessages, { id, text, severity, expiresAt }]
      if (next.length > MAX_SYSTEM_MESSAGES) next.splice(0, next.length - MAX_SYSTEM_MESSAGES)
      return { systemMessages: next }
    })
    return id
  },
  dismissSystemMessage: (id) =>
    set((s) => ({ systemMessages: s.systemMessages.filter((m) => m.id !== id) })),
  clearExpiredSystemMessages: (now = Date.now()) =>
    set((s) => {
      const remaining = s.systemMessages.filter((m) => m.expiresAt > now)
      return remaining.length === s.systemMessages.length ? s : { systemMessages: remaining }
    }),
}))
