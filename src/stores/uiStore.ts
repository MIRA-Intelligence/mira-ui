import { create } from 'zustand'

interface UiState {
  sidebarCollapsed: boolean
  agentPanelCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleAgentPanel: () => void
  setAgentPanelCollapsed: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  agentPanelCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleAgentPanel: () => set((s) => ({ agentPanelCollapsed: !s.agentPanelCollapsed })),
  setAgentPanelCollapsed: (v) => set({ agentPanelCollapsed: v }),
}))
