import { create } from 'zustand'
import type { ProjectFileEntry, StartableModuleType, WorkflowModuleType } from '@/types'

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

export interface PromotionRequest {
  // The Quick Chat thread whose conversation is attached to the new project.
  chatId: string
  moduleType: StartableModuleType
}

// Opens a module's start dialog in WorkflowWorkspace from outside that component.
export interface ModuleStartRequest {
  projectId: string
  moduleType: WorkflowModuleType
  intent: string
  contextPath?: string
}

interface UiState {
  sidebarCollapsed: boolean
  /** Quick-chat center pane (home / file preview) collapsed to foreground the agent workbench. */
  chatCenterCollapsed: boolean
  /**
   * When true the center pane follows the chat: open (as a home page) until the
   * chat has a message, then collapsed. A manual toggle or a file preview turns
   * this off until the next chat is opened; chatCenterCollapsed then applies.
   */
  chatCenterAuto: boolean
  /** Bumped when files are added to a chat folder outside the explorer, so it re-lists. */
  chatFilesRevision: number
  agentPanelCollapsed: boolean
  sidebarWidth: number
  agentPanelWidth: number
  resourcePanelWidth: number
  workbenchTab: WorkbenchTab
  /** Chat-mode center pane: file preview (normal mode only). */
  chatCenterPreviewFile: ProjectFileEntry | null
  /** One-shot prompt seed for the agent composer (chat mode home chips). */
  agentDraftPrompt: string | null
  promotion: PromotionRequest | null
  pendingModuleStart: ModuleStartRequest | null
  skillsPluginsOpen: boolean
  providersOpen: boolean
  // Team server administrators: everyone's usage and the token quotas.
  teamUsageOpen: boolean
  knowledgeOpen: boolean
  communityOpen: boolean
  onboardingOpen: boolean
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
  toggleChatCenter: () => void
  setChatCenterCollapsed: (v: boolean) => void
  /** Show the agent workbench and let the home pane follow the chat (chat mode). */
  focusQuickChatWorkbench: () => void
  bumpChatFiles: () => void
  toggleAgentPanel: () => void
  setAgentPanelCollapsed: (v: boolean) => void
  setAgentPanelWidth: (px: number) => void
  setResourcePanelWidth: (px: number) => void
  setWorkbenchTab: (tab: WorkbenchTab) => void
  setChatCenterPreviewFile: (file: ProjectFileEntry | null) => void
  setAgentDraftPrompt: (text: string | null) => void
  openPromotion: (chatId: string, moduleType: StartableModuleType) => void
  closePromotion: () => void
  requestModuleStart: (request: ModuleStartRequest) => void
  consumeModuleStart: () => void
  openSkillsPlugins: () => void
  closeSkillsPlugins: () => void
  openProviders: () => void
  closeProviders: () => void
  openTeamUsage: () => void
  closeTeamUsage: () => void
  openKnowledge: () => void
  closeKnowledge: () => void
  openCommunity: () => void
  closeCommunity: () => void
  openOnboarding: () => void
  closeOnboarding: () => void
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
  chatCenterCollapsed: false,
  chatCenterAuto: true,
  chatFilesRevision: 0,
  agentPanelCollapsed: false,
  sidebarWidth: loadWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH),
  agentPanelWidth: loadWidth(AGENT_PANEL_WIDTH_KEY, AGENT_PANEL_WIDTH),
  resourcePanelWidth: loadWidth(RESOURCE_PANEL_WIDTH_KEY, RESOURCE_PANEL_WIDTH),
  workbenchTab: loadWorkbenchTab(),
  chatCenterPreviewFile: null,
  agentDraftPrompt: null,
  promotion: null,
  pendingModuleStart: null,
  skillsPluginsOpen: false,
  providersOpen: false,
  teamUsageOpen: false,
  knowledgeOpen: false,
  communityOpen: false,
  onboardingOpen: false,
  availableUpdate: null,
  updateBannerDismissed: false,
  systemMessages: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleChatCenter: () => set((s) => ({ chatCenterAuto: false, chatCenterCollapsed: !s.chatCenterCollapsed })),
  setChatCenterCollapsed: (v) => set({ chatCenterAuto: false, chatCenterCollapsed: v }),
  focusQuickChatWorkbench: () => {
    saveWorkbenchTab('agent')
    set({
      chatCenterAuto: true,
      agentPanelCollapsed: false,
      workbenchTab: 'agent',
      chatCenterPreviewFile: null,
    })
  },
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
  setChatCenterPreviewFile: (file) =>
    set({
      chatCenterPreviewFile: file,
      ...(file ? { chatCenterAuto: false, chatCenterCollapsed: false } : {}),
    }),
  bumpChatFiles: () => set((s) => ({ chatFilesRevision: s.chatFilesRevision + 1 })),
  setAgentDraftPrompt: (text) => set({ agentDraftPrompt: text }),
  openPromotion: (chatId, moduleType) => set({ promotion: { chatId, moduleType } }),
  closePromotion: () => set({ promotion: null }),
  requestModuleStart: (request) => set({ pendingModuleStart: request }),
  consumeModuleStart: () => set({ pendingModuleStart: null }),
  openSkillsPlugins: () => set({ skillsPluginsOpen: true }),
  closeSkillsPlugins: () => set({ skillsPluginsOpen: false }),
  openProviders: () => set({ providersOpen: true }),
  closeProviders: () => set({ providersOpen: false }),
  openTeamUsage: () => set({ teamUsageOpen: true }),
  closeTeamUsage: () => set({ teamUsageOpen: false }),
  openKnowledge: () => set({ knowledgeOpen: true }),
  closeKnowledge: () => set({ knowledgeOpen: false }),
  openCommunity: () => set({ communityOpen: true }),
  closeCommunity: () => set({ communityOpen: false }),
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),
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
