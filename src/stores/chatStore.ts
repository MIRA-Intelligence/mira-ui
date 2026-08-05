import { create } from 'zustand'
import { newChatSessionId } from '@/lib/sessions'
import { useProjectStore } from '@/stores/projectStore'
import {
  deleteOrganizationChat,
  importOrganizationChats,
  updateOrganizationChat,
  type RemoteChat,
} from '@/services/api'

/**
 * A lightweight Quick Chat conversation (basic loop). Unlike a research
 * project it has no plan, experiments, or project directory — just a thread of
 * messages persisted by the engine under the workspace session log
 * (`ui:<chat-id>`). The chat index itself lives in localStorage, scoped per
 * workspace, so threads survive reloads and can be renamed / resumed / deleted.
 */
export interface ChatThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

const STORAGE_PREFIX = 'mira.chats:'
const TITLE_MAX_CHARS = 60

function storageKey(workspaceKey: string): string {
  return `${STORAGE_PREFIX}${workspaceKey}`
}

function readChats(workspaceKey: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (c): c is ChatThread =>
        !!c && typeof c.id === 'string' && typeof c.title === 'string',
    )
  } catch {
    return []
  }
}

function writeChats(workspaceKey: string, chats: ChatThread[]): void {
  try {
    localStorage.setItem(storageKey(workspaceKey), JSON.stringify(chats))
  } catch {
    // Ignore unavailable / quota-exceeded storage.
  }
}

async function clearChatLogs(chatId: string): Promise<void> {
  try {
    const { useAgentStore } = await import('@/stores/agentStore')
    useAgentStore.getState().clearLogs(chatId)
  } catch {
    // Ignore optional log cleanup failures.
  }
}

interface ChatState {
  chats: ChatThread[]
  activeChatId: string | null
  workspaceKey: string

  loadForWorkspace: (workspaceKey: string) => void
  replaceFromRemote: (chats: RemoteChat[]) => void
  createChat: () => string
  selectChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  touchChat: (id: string, fallbackTitle?: string) => void
  deleteChat: (id: string) => void
  removeChat: (id: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  workspaceKey: '',

  loadForWorkspace: (workspaceKey) => {
    if (get().workspaceKey === workspaceKey && get().chats.length > 0) return
    set({ workspaceKey, chats: readChats(workspaceKey), activeChatId: null })
  },

  replaceFromRemote: (remoteChats) => {
    set((state) => {
      const chats = remoteChats
        .map((chat): ChatThread => ({
          id: chat.id,
          title: chat.title,
          createdAt: Date.parse(chat.created_at) || Date.now(),
          updatedAt: Date.parse(chat.updated_at) || Date.now(),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      writeChats(state.workspaceKey, chats)
      const activeChatId = state.activeChatId && chats.some((chat) => chat.id === state.activeChatId)
        ? state.activeChatId
        : null
      return { chats, activeChatId }
    })
  },

  createChat: () => {
    const id = newChatSessionId()
    const now = Date.now()
    const chat: ChatThread = { id, title: '', createdAt: now, updatedAt: now }
    set((s) => {
      const chats = [chat, ...s.chats]
      writeChats(s.workspaceKey, chats)
      return { chats, activeChatId: id }
    })
    void importOrganizationChats([{
      id,
      title: '',
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    }]).catch(() => {})
    useProjectStore.getState().setAppMode('normal')
    return id
  },

  selectChat: (id) => {
    set({ activeChatId: id })
    useProjectStore.getState().setAppMode('normal')
  },

  renameChat: (id, title) => {
    const next = title.trim()
    if (!next) return
    set((s) => {
      const chats = s.chats.map((c) => (c.id === id ? { ...c, title: next.slice(0, TITLE_MAX_CHARS) } : c))
      writeChats(s.workspaceKey, chats)
      return { chats }
    })
    void updateOrganizationChat(id, { title: next }).catch(() => {})
  },

  // Bump updatedAt and, for an untitled thread, seed a title from the first
  // message so the queue shows something meaningful.
  touchChat: (id, fallbackTitle) => {
    const previous = get().chats.find((chat) => chat.id === id)
    set((s) => {
      let changed = false
      const chats = s.chats.map((c) => {
        if (c.id !== id) return c
        changed = true
        const title = c.title || (fallbackTitle ? fallbackTitle.trim().slice(0, TITLE_MAX_CHARS) : c.title)
        return { ...c, title, updatedAt: Date.now() }
      })
      if (!changed) return s
      writeChats(s.workspaceKey, chats)
      return { chats }
    })
    if (previous) {
      void updateOrganizationChat(id, {
        ...(!previous.title && fallbackTitle ? { title: fallbackTitle.trim().slice(0, TITLE_MAX_CHARS) } : {}),
        touch: true,
      }).catch(() => {})
    }
  },

  // Remove without touching app mode (used when promoting a chat to a project,
  // where createProject already switches into project mode).
  removeChat: (id) => {
    void clearChatLogs(id)
    void deleteOrganizationChat(id).catch(() => {})
    set((s) => {
      const chats = s.chats.filter((c) => c.id !== id)
      writeChats(s.workspaceKey, chats)
      return { chats, activeChatId: s.activeChatId === id ? null : s.activeChatId }
    })
  },

  deleteChat: (id) => {
    const wasActive = get().activeChatId === id
    void clearChatLogs(id)
    void deleteOrganizationChat(id).catch(() => {})
    set((s) => {
      const chats = s.chats.filter((c) => c.id !== id)
      writeChats(s.workspaceKey, chats)
      return { chats }
    })
    if (!wasActive) return
    const remaining = get().chats
    if (remaining.length > 0) {
      get().selectChat(remaining[0].id)
    } else {
      set({ activeChatId: null })
      useProjectStore.getState().setAppMode('project')
    }
  },
}))
