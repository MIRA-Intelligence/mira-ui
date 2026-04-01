import { create } from 'zustand'

interface UiState {
  sidebarCollapsed: boolean
  agentPanelCollapsed: boolean
  newProjectOpen: boolean
  skillsPluginsOpen: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleAgentPanel: () => void
  setAgentPanelCollapsed: (v: boolean) => void
  openNewProject: () => void
  closeNewProject: () => void
  openSkillsPlugins: () => void
  closeSkillsPlugins: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  agentPanelCollapsed: false,
  newProjectOpen: false,
  skillsPluginsOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleAgentPanel: () => set((s) => ({ agentPanelCollapsed: !s.agentPanelCollapsed })),
  setAgentPanelCollapsed: (v) => set({ agentPanelCollapsed: v }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openSkillsPlugins: () => set({ skillsPluginsOpen: true }),
  closeSkillsPlugins: () => set({ skillsPluginsOpen: false }),
}))
