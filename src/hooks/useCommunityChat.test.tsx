import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCommunityChat } from './useCommunityChat'
import { fetchSessionHistory } from '@/services/api'
import { wsClient } from '@/services/websocket'
import type { CommunityStatus } from '@/services/community'
import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'
import { countUnread, useCommunityChatStore } from '@/stores/communityChatStore'
import { useCommunityStore } from '@/stores/communityStore'
import { useProjectStore } from '@/stores/projectStore'
import { installLocalStorage } from '@/test/localStorage'
import type { LogEntry } from '@/types'

vi.mock('@/services/websocket', () => ({
  wsClient: { send: vi.fn() },
}))

vi.mock('@/services/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/api')>(),
  fetchSessionHistory: vi.fn().mockResolvedValue([]),
}))

const initialAgentState = useAgentStore.getState()
const initialCommunityState = useCommunityStore.getState()
const initialChatState = useChatStore.getState()
const initialProjectState = useProjectStore.getState()

const memberStatus = (): CommunityStatus => ({
  enabled: true,
  logged_in: true,
  agent_id: 'agent-1',
  api_base: 'http://x/community',
  autonomy_mode: 'hybrid',
  code_host: 'github',
  domains: [],
  pending_count: 0,
  chat_id: 'community',
})

const agentMessage = (timestamp: string): LogEntry => ({ id: `m-${timestamp}`, timestamp, content: 'I voted on p1.', type: 'response' })

describe('useCommunityChat', () => {
  beforeEach(() => {
    installLocalStorage()
    vi.mocked(wsClient.send).mockClear()
    vi.mocked(fetchSessionHistory).mockReset().mockResolvedValue([])
    useAgentStore.setState(initialAgentState, true)
    useCommunityStore.setState(initialCommunityState, true)
    useChatStore.setState(initialChatState, true)
    useProjectStore.setState(initialProjectState, true)
    useAgentStore.setState({ connected: false, logsByProject: {} })
    useCommunityStore.setState({ status: null, refresh: vi.fn().mockResolvedValue(undefined) })
    useChatStore.setState({ chats: [], activeChatId: null, workspaceKey: 'ws' })
    useProjectStore.setState({ appMode: 'project' })
    useCommunityChatStore.setState({ workspaceKey: '', lastSeenAt: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads membership on connect, binds the community chat and loads what the agent wrote', async () => {
    vi.mocked(fetchSessionHistory).mockResolvedValue([agentMessage('2026-10-26T11:00:00Z')])
    useCommunityStore.setState({ status: memberStatus() })
    renderHook(() => useCommunityChat())
    expect(wsClient.send).not.toHaveBeenCalled()

    act(() => { useAgentStore.setState({ connected: true }) })

    expect(useCommunityStore.getState().refresh).toHaveBeenCalledTimes(1)
    expect(wsClient.send).toHaveBeenCalledWith({ type: 'bind', content: '', session_id: 'community', user_id: 'ui_user' })
    expect(fetchSessionHistory).toHaveBeenCalledWith('community')
    await waitFor(() => expect(useAgentStore.getState().logsByProject.community).toHaveLength(1))
    // Nothing was looked at yet: the message counts as unread.
    expect(countUnread(useAgentStore.getState().logsByProject.community, useCommunityChatStore.getState().lastSeenAt)).toBe(1)
  })

  it('binds as soon as the user joins while already connected', () => {
    useAgentStore.setState({ connected: true })
    renderHook(() => useCommunityChat())
    expect(wsClient.send).not.toHaveBeenCalled()

    act(() => { useCommunityStore.setState({ status: memberStatus() }) })

    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'bind', session_id: 'community' }))
  })

  it('does nothing for a user who has not joined, or an engine without the chat', () => {
    useAgentStore.setState({ connected: true })
    useCommunityStore.setState({ status: { ...memberStatus(), logged_in: false } })
    const { rerender } = renderHook(() => useCommunityChat())
    act(() => { useCommunityStore.setState({ status: { ...memberStatus(), chat_id: undefined } }) })
    rerender()
    expect(wsClient.send).not.toHaveBeenCalled()
    expect(fetchSessionHistory).not.toHaveBeenCalled()
  })

  it('counts what arrives as seen only while the chat is open', () => {
    useCommunityStore.setState({ status: memberStatus() })
    useAgentStore.setState({ connected: true })
    renderHook(() => useCommunityChat())

    act(() => { useAgentStore.getState().addLog('community', agentMessage('2026-10-26T11:00:00Z')) })
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(0)

    act(() => {
      useProjectStore.setState({ appMode: 'normal' })
      useChatStore.setState({ activeChatId: 'community' })
    })
    const seenAt = Date.parse('2026-10-26T11:00:00Z')
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(seenAt)
    expect(localStorage.getItem('mira.communityChat.lastSeen:ws')).toBe(String(seenAt))

    // A later message while the chat is open is seen too; the user's own messages do not count.
    act(() => { useAgentStore.getState().addLog('community', agentMessage('2026-10-26T12:00:00Z')) })
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(Date.parse('2026-10-26T12:00:00Z'))
    act(() => { useAgentStore.getState().addLog('community', { ...agentMessage('2026-10-26T13:00:00Z'), metadata: { _user: true } }) })
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(Date.parse('2026-10-26T12:00:00Z'))
  })
})
