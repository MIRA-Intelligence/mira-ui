import { create } from 'zustand'
import type { ProjectFileEntry } from '@/types'

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
export const AGENT_PANEL_WIDTH = { min: 480, max: 1200, default: 720 } as const
export const RESOURCE_PANEL_WIDTH = { min: 200, max: 520, default: 280 } as const

const SIDEBAR_WIDTH_KEY = 'mira:ui:sidebarWidth'
const AGENT_PANEL_WIDTH_KEY = 'mira:ui:agentPanelWidth'
const RESOURCE_PANEL_WIDTH_KEY = 'mira:ui:resourcePanelWidth'
const WORKBENCH_TAB_KEY = 'mira:ui:workbenchTab'

export type WorkbenchTab = 'files' | 'agent'

function loadWorkbenchTab(): WorkbenchTab {
  try {
    const raw = localStorage.getItem(WORKBENCH_TAB_KEY)
    if (raw === 'files' || raw === 'agent') return raw
  } catch {
    // ignore
  }
  return 'agent'
}

function saveWorkbenchTab(tab: WorkbenchTab) {
  try {
    localStorage.setItem(WORKBENCH_TAB_KEY, tab)
  } catch {
    // ignore
  }
}

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
  resourcePanelWidth: number
  workbenchTab: WorkbenchTab
  /** Chat-mode center pane: file preview (normal mode only). */
  chatCenterPreviewFile: ProjectFileEntry | null
  /** One-shot prompt seed for the agent composer (chat mode home chips). */
  agentDraftPrompt: string | null
  newProjectOpen: boolean
  newProjectPrefill: string | null
  newProjectFromChatId: string | null
  skillsPluginsOpen: boolean
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
  setResourcePanelWidth: (px: number) => void
  setWorkbenchTab: (tab: WorkbenchTab) => void
  setChatCenterPreviewFile: (file: ProjectFileEntry | null) => void
  setAgentDraftPrompt: (text: string | null) => void
  openNewProject: (options?: OpenNewProjectOptions) => void
  closeNewProject: () => void
  openSkillsPlugins: () => void
  closeSkillsPlugins: () => void
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
  resourcePanelWidth: loadWidth(RESOURCE_PANEL_WIDTH_KEY, RESOURCE_PANEL_WIDTH),
  workbenchTab: loadWorkbenchTab(),
  chatCenterPreviewFile: null,
  agentDraftPrompt: null,
  newProjectOpen: false,
  newProjectPrefill: null,
  newProjectFromChatId: null,
  skillsPluginsOpen: false,
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
  setResourcePanelWidth: (px) => {
    const w = clamp(px, RESOURCE_PANEL_WIDTH.min, RESOURCE_PANEL_WIDTH.max)
    saveWidth(RESOURCE_PANEL_WIDTH_KEY, w)
    set({ resourcePanelWidth: w })
  },
  setWorkbenchTab: (tab) => {
    saveWorkbenchTab(tab)
    set({ workbenchTab: tab })
  },
  setChatCenterPreviewFile: (file) => set({ chatCenterPreviewFile: file }),
  setAgentDraftPrompt: (text) => set({ agentDraftPrompt: text }),
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
