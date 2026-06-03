import { create } from 'zustand'

import {
  fetchSkillPlugins,
  installSkillPluginFromDirectory,
  installSkillPluginFromZip,
  setSkillPluginState,
  uninstallSkillPlugin,
} from '@/services/api'
import type {
  SkillPlugin,
  SkillPluginScope,
  SkillPluginTargetType,
} from '@/types'

// Skills are managed at a single, project-independent scope. This sentinel
// session id tells the engine to operate on the global workspace rather than
// a specific project directory.
export const GLOBAL_SKILLS_SESSION_ID = '__global__'

interface SkillPluginsState {
  plugins: SkillPlugin[]
  scope: SkillPluginScope
  loading: boolean
  error: string | null
  installPath: string
  setScope: (scope: SkillPluginScope) => void
  setInstallPath: (path: string) => void
  clearError: () => void
  load: (sessionId: string) => Promise<void>
  installFromDirectory: (sessionId: string) => Promise<void>
  installFromZip: (sessionId: string, file: File) => Promise<void>
  toggle: (
    sessionId: string,
    targetType: SkillPluginTargetType,
    pluginId: string,
    enabled: boolean,
    targetId?: string,
  ) => Promise<void>
  uninstall: (sessionId: string, pluginId: string) => Promise<void>
}

function parseError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export const useSkillPluginsStore = create<SkillPluginsState>((set, get) => ({
  plugins: [],
  scope: 'global',
  loading: false,
  error: null,
  installPath: '',
  setScope: (scope) => set({ scope }),
  setInstallPath: (path) => set({ installPath: path }),
  clearError: () => set({ error: null }),

  load: async (sessionId) => {
    set({ loading: true, error: null })
    try {
      const plugins = await fetchSkillPlugins(sessionId)
      set({ plugins, loading: false })
    } catch (err) {
      set({ loading: false, error: parseError(err) })
    }
  },

  installFromDirectory: async (sessionId) => {
    const path = get().installPath.trim()
    if (!path) {
      set({ error: 'Plugin directory path is required.' })
      return
    }
    set({ loading: true, error: null })
    try {
      const plugins = await installSkillPluginFromDirectory(sessionId, path)
      set({ plugins, loading: false, installPath: '' })
    } catch (err) {
      set({ loading: false, error: parseError(err) })
    }
  },

  installFromZip: async (sessionId, file) => {
    set({ loading: true, error: null })
    try {
      const plugins = await installSkillPluginFromZip(sessionId, file)
      set({ plugins, loading: false })
    } catch (err) {
      set({ loading: false, error: parseError(err) })
    }
  },

  toggle: async (sessionId, targetType, pluginId, enabled, targetId) => {
    set({ loading: true, error: null })
    try {
      const plugins = await setSkillPluginState(sessionId, {
        scope: get().scope,
        target_type: targetType,
        plugin_id: pluginId,
        enabled,
        target_id: targetId,
      })
      set({ plugins, loading: false })
    } catch (err) {
      set({ loading: false, error: parseError(err) })
    }
  },

  uninstall: async (sessionId, pluginId) => {
    set({ loading: true, error: null })
    try {
      const plugins = await uninstallSkillPlugin(sessionId, pluginId)
      set({ plugins, loading: false })
    } catch (err) {
      set({ loading: false, error: parseError(err) })
    }
  },
}))
