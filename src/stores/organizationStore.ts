import { create } from 'zustand'
import {
  assignOrganizationFolder,
  createOrganizationFolder,
  deleteOrganizationFolder,
  fetchOrganization,
  importOrganizationChats,
  renameOrganizationFolder,
  type OrganizationFolder,
  type OrganizationSnapshot,
  type RemoteChat,
} from '@/services/api'

export type OrganizationKind = 'chat' | 'project'

const emptyAssignments = (): OrganizationSnapshot['assignments'] => ({ chat: {}, project: {} })
const CACHE_PREFIX = 'mira.organization:'

function readCache(workspaceKey: string): Pick<OrganizationSnapshot, 'folders' | 'assignments'> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${workspaceKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OrganizationSnapshot>
    if (!Array.isArray(parsed.folders) || !parsed.assignments) return null
    return { folders: parsed.folders, assignments: parsed.assignments }
  } catch {
    return null
  }
}

function writeCache(workspaceKey: string, folders: OrganizationFolder[], assignments: OrganizationSnapshot['assignments']) {
  if (!workspaceKey) return
  try {
    localStorage.setItem(`${CACHE_PREFIX}${workspaceKey}`, JSON.stringify({ folders, assignments }))
  } catch {
    // The backend remains authoritative if local cache storage is unavailable.
  }
}

interface OrganizationState {
  folders: OrganizationFolder[]
  assignments: OrganizationSnapshot['assignments']
  loaded: boolean
  loading: boolean
  error: string | null
  workspaceKey: string
  load: (cachedChats?: RemoteChat[], workspaceKey?: string) => Promise<OrganizationSnapshot | null>
  createFolder: (name: string) => Promise<OrganizationFolder>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveItem: (kind: OrganizationKind, itemId: string, folderId: string | null) => Promise<void>
  reset: () => void
}

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
  folders: [],
  assignments: emptyAssignments(),
  loaded: false,
  loading: false,
  error: null,
  workspaceKey: '',

  load: async (cachedChats = [], workspaceKey = '') => {
    set({ loading: true, error: null, workspaceKey })
    try {
      if (cachedChats.length > 0) await importOrganizationChats(cachedChats)
      const snapshot = await fetchOrganization()
      set({
        folders: snapshot.folders,
        assignments: snapshot.assignments,
        loaded: true,
        loading: false,
      })
      writeCache(workspaceKey, snapshot.folders, snapshot.assignments)
      return snapshot
    } catch (error) {
      const cached = readCache(workspaceKey)
      set({
        ...(cached ?? {}),
        loaded: false,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  createFolder: async (name) => {
    const folder = await createOrganizationFolder(name)
    set((state) => {
      const folders = [...state.folders, folder]
      writeCache(state.workspaceKey, folders, state.assignments)
      return { folders }
    })
    return folder
  },

  renameFolder: async (folderId, name) => {
    const previous = get().folders
    set({ folders: previous.map((folder) => folder.id === folderId ? { ...folder, name } : folder) })
    try {
      const saved = await renameOrganizationFolder(folderId, name)
      set((state) => {
        const folders = state.folders.map((folder) => folder.id === folderId ? saved : folder)
        writeCache(state.workspaceKey, folders, state.assignments)
        return { folders }
      })
    } catch (error) {
      set({ folders: previous })
      throw error
    }
  },

  deleteFolder: async (folderId) => {
    const previousFolders = get().folders
    const previousAssignments = get().assignments
    const clearFolder = (mapping: Record<string, string>) => Object.fromEntries(
      Object.entries(mapping).filter(([, value]) => value !== folderId),
    )
    set({
      folders: previousFolders.filter((folder) => folder.id !== folderId),
      assignments: {
        chat: clearFolder(previousAssignments.chat),
        project: clearFolder(previousAssignments.project),
      },
    })
    try {
      await deleteOrganizationFolder(folderId)
      const state = get()
      writeCache(state.workspaceKey, state.folders, state.assignments)
    } catch (error) {
      set({ folders: previousFolders, assignments: previousAssignments })
      throw error
    }
  },

  moveItem: async (kind, itemId, folderId) => {
    const previous = get().assignments
    const nextKind = { ...previous[kind] }
    if (folderId) nextKind[itemId] = folderId
    else delete nextKind[itemId]
    set({ assignments: { ...previous, [kind]: nextKind } })
    try {
      await assignOrganizationFolder(kind, itemId, folderId)
      const state = get()
      writeCache(state.workspaceKey, state.folders, state.assignments)
    } catch (error) {
      set({ assignments: previous })
      throw error
    }
  },

  reset: () => set({ folders: [], assignments: emptyAssignments(), loaded: false, loading: false, error: null, workspaceKey: '' }),
}))
