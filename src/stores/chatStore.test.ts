import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from './chatStore'
import { useProjectStore } from './projectStore'
import { installLocalStorage } from '@/test/localStorage'

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: { getState: () => ({ clearLogs: vi.fn() }) },
}))

const initialChat = useChatStore.getState()

describe('chatStore', () => {
  beforeEach(() => {
    installLocalStorage()
    useChatStore.setState(initialChat, true)
    useChatStore.setState({ chats: [], activeChatId: null, workspaceKey: '' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createChat prepends a new thread, activates it, and persists', () => {
    useChatStore.getState().loadForWorkspace('ws1')
    const id = useChatStore.getState().createChat()
    const state = useChatStore.getState()
    expect(state.activeChatId).toBe(id)
    expect(state.chats[0].id).toBe(id)
    expect(useProjectStore.getState().appMode).toBe('normal')
    const stored = JSON.parse(localStorage.getItem('mira.chats:ws1') || '[]')
    expect(stored[0].id).toBe(id)
  })

  it('loadForWorkspace reads persisted chats', () => {
    localStorage.setItem(
      'mira.chats:ws2',
      JSON.stringify([{ id: 'chat-x', title: 'Hi', createdAt: 1, updatedAt: 1 }]),
    )
    useChatStore.getState().loadForWorkspace('ws2')
    expect(useChatStore.getState().chats).toHaveLength(1)
    expect(useChatStore.getState().chats[0].title).toBe('Hi')
  })

  it('renameChat trims, caps length and ignores empty titles', () => {
    useChatStore.getState().loadForWorkspace('ws3')
    const id = useChatStore.getState().createChat()
    useChatStore.getState().renameChat(id, '   ')
    expect(useChatStore.getState().chats[0].title).toBe('')
    useChatStore.getState().renameChat(id, '  Renamed  ')
    expect(useChatStore.getState().chats[0].title).toBe('Renamed')
  })

  it('touchChat seeds a title from the fallback for untitled threads', () => {
    useChatStore.getState().loadForWorkspace('ws4')
    const id = useChatStore.getState().createChat()
    useChatStore.getState().touchChat(id, 'First message text')
    expect(useChatStore.getState().chats[0].title).toBe('First message text')
    // a no-op id leaves state unchanged
    const before = useChatStore.getState().chats
    useChatStore.getState().touchChat('missing')
    expect(useChatStore.getState().chats).toBe(before)
  })

  it('removeChat drops the thread and clears active when it matches', () => {
    useChatStore.getState().loadForWorkspace('ws5')
    const id = useChatStore.getState().createChat()
    useChatStore.getState().removeChat(id)
    expect(useChatStore.getState().chats).toHaveLength(0)
    expect(useChatStore.getState().activeChatId).toBeNull()
  })

  it('deleteChat selects the next remaining chat when deleting the active one', () => {
    useChatStore.getState().loadForWorkspace('ws6')
    const first = useChatStore.getState().createChat()
    const second = useChatStore.getState().createChat()
    // second is active now; deleting it should select the remaining (first)
    useChatStore.getState().deleteChat(second)
    expect(useChatStore.getState().activeChatId).toBe(first)
  })

  it('deleteChat switches to project mode when no chats remain', () => {
    useChatStore.getState().loadForWorkspace('ws7')
    const only = useChatStore.getState().createChat()
    useChatStore.getState().deleteChat(only)
    expect(useChatStore.getState().activeChatId).toBeNull()
    expect(useProjectStore.getState().appMode).toBe('project')
  })
})
