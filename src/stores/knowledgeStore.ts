import { create } from 'zustand'

import {
  addKnowledgeSource,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeSource,
  fetchProjectKnowledge,
  getKnowledgeBase,
  listKnowledgeBases,
  refreshKnowledgeSource,
  saveProjectKnowledge,
  updateKnowledgeBase,
  uploadKnowledgeFiles,
  type KnowledgeBaseDetail,
  type KnowledgeBaseSummary,
  type NewKnowledgeSource,
} from '@/services/knowledge'

// Quick Chat has no project to attach bases to, so the choice is remembered
// per chat on this device and sent with each message.
const CHAT_SELECTIONS_KEY = 'mira:knowledge:chatSelections'

function loadChatSelections(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CHAT_SELECTIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : {}
  } catch {
    return {}
  }
}

function saveChatSelections(value: Record<string, string[]>) {
  try {
    localStorage.setItem(CHAT_SELECTIONS_KEY, JSON.stringify(value))
  } catch {
    // Non-persisted selection is acceptable (e.g. private mode).
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isIngesting(detail: KnowledgeBaseDetail | undefined): boolean {
  return Boolean(detail?.sources.some((s) => s.status === 'pending' || s.status === 'processing'))
}

interface KnowledgeState {
  bases: KnowledgeBaseSummary[]
  details: Record<string, KnowledgeBaseDetail>
  loaded: boolean
  loading: boolean
  error: string | null
  projectBases: Record<string, string[]>
  chatBases: Record<string, string[]>
  clearError: () => void
  loadBases: () => Promise<void>
  loadDetail: (kbId: string) => Promise<void>
  create: (name: string, description: string) => Promise<string | null>
  update: (kbId: string, patch: { name?: string; description?: string }) => Promise<boolean>
  remove: (kbId: string) => Promise<void>
  upload: (kbId: string, files: File[]) => Promise<boolean>
  addSource: (kbId: string, source: NewKnowledgeSource) => Promise<boolean>
  removeSource: (kbId: string, sourceId: string) => Promise<void>
  refreshSource: (kbId: string, sourceId: string) => Promise<void>
  loadProjectBases: (projectId: string) => Promise<void>
  setProjectBases: (projectId: string, kbIds: string[]) => Promise<void>
  setChatBases: (chatId: string, kbIds: string[]) => void
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => {
  // Every mutation refreshes the base's detail and the list counts.
  const reload = async (kbId: string) => {
    await Promise.all([get().loadDetail(kbId), get().loadBases()])
  }

  const attempt = async (fn: () => Promise<void>): Promise<boolean> => {
    set({ error: null })
    try {
      await fn()
      return true
    } catch (err) {
      set({ error: message(err) })
      return false
    }
  }

  return {
    bases: [],
    details: {},
    loaded: false,
    loading: false,
    error: null,
    projectBases: {},
    chatBases: loadChatSelections(),
    clearError: () => set({ error: null }),

    loadBases: async () => {
      set({ loading: true })
      try {
        const bases = await listKnowledgeBases()
        set({ bases, loaded: true, loading: false })
      } catch (err) {
        set({ loading: false, loaded: true, error: message(err) })
      }
    },

    loadDetail: async (kbId) => {
      try {
        const detail = await getKnowledgeBase(kbId)
        set((s) => ({ details: { ...s.details, [kbId]: detail } }))
      } catch (err) {
        set({ error: message(err) })
      }
    },

    create: async (name, description) => {
      let id: string | null = null
      await attempt(async () => {
        const detail = await createKnowledgeBase(name, description)
        id = detail.id
        set((s) => ({ details: { ...s.details, [detail.id]: detail } }))
        await get().loadBases()
      })
      return id
    },

    update: (kbId, patch) => attempt(async () => {
      const detail = await updateKnowledgeBase(kbId, patch)
      set((s) => ({ details: { ...s.details, [kbId]: detail } }))
      await get().loadBases()
    }),

    remove: async (kbId) => {
      await attempt(async () => {
        await deleteKnowledgeBase(kbId)
        set((s) => {
          const { [kbId]: _removed, ...details } = s.details
          const strip = (map: Record<string, string[]>) =>
            Object.fromEntries(Object.entries(map).map(([k, ids]) => [k, ids.filter((id) => id !== kbId)]))
          const chatBases = strip(s.chatBases)
          saveChatSelections(chatBases)
          return { details, chatBases, projectBases: strip(s.projectBases) }
        })
        await get().loadBases()
      })
    },

    upload: (kbId, files) => attempt(async () => {
      if (files.length === 0) return
      await uploadKnowledgeFiles(kbId, files)
      await reload(kbId)
    }),

    addSource: (kbId, source) => attempt(async () => {
      await addKnowledgeSource(kbId, source)
      await reload(kbId)
    }),

    removeSource: async (kbId, sourceId) => {
      await attempt(async () => {
        await deleteKnowledgeSource(kbId, sourceId)
        await reload(kbId)
      })
    },

    refreshSource: async (kbId, sourceId) => {
      await attempt(async () => {
        await refreshKnowledgeSource(kbId, sourceId)
        await reload(kbId)
      })
    },

    loadProjectBases: async (projectId) => {
      try {
        const ids = await fetchProjectKnowledge(projectId)
        set((s) => ({ projectBases: { ...s.projectBases, [projectId]: ids } }))
      } catch {
        // Older engines have no knowledge endpoints; the picker just stays empty.
      }
    },

    setProjectBases: async (projectId, kbIds) => {
      const previous = get().projectBases[projectId] ?? []
      set((s) => ({ projectBases: { ...s.projectBases, [projectId]: kbIds } }))
      const ok = await attempt(async () => {
        const saved = await saveProjectKnowledge(projectId, kbIds)
        set((s) => ({ projectBases: { ...s.projectBases, [projectId]: saved } }))
      })
      if (!ok) set((s) => ({ projectBases: { ...s.projectBases, [projectId]: previous } }))
    },

    setChatBases: (chatId, kbIds) => {
      set((s) => {
        const chatBases = { ...s.chatBases }
        if (kbIds.length) chatBases[chatId] = kbIds
        else delete chatBases[chatId]
        saveChatSelections(chatBases)
        return { chatBases }
      })
    },
  }
})
