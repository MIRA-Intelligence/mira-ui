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

interface UiState {
  sidebarCollapsed: boolean
  agentPanelCollapsed: boolean
  newProjectOpen: boolean
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
  toggleAgentPanel: () => void
  setAgentPanelCollapsed: (v: boolean) => void
  openNewProject: () => void
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
  newProjectOpen: false,
  skillsPluginsOpen: false,
  availableUpdate: null,
  updateBannerDismissed: false,
  systemMessages: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleAgentPanel: () => set((s) => ({ agentPanelCollapsed: !s.agentPanelCollapsed })),
  setAgentPanelCollapsed: (v) => set({ agentPanelCollapsed: v }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
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
