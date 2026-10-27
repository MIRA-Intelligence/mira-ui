import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countUnread,
  isAgentMessage,
  newestAgentMessageAt,
  useCommunityChatStore,
} from './communityChatStore'
import { installLocalStorage } from '@/test/localStorage'
import type { LogEntry } from '@/types'

const entry = (id: string, timestamp: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  id,
  timestamp,
  content: id,
  type: 'response',
  ...extra,
})

describe('communityChatStore', () => {
  beforeEach(() => {
    installLocalStorage()
    useCommunityChatStore.setState({ workspaceKey: '', lastSeenAt: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('remembers per workspace when the user last looked, and never moves backwards', () => {
    localStorage.setItem('mira.communityChat.lastSeen:ws1', '1000')
    useCommunityChatStore.getState().loadForWorkspace('ws1')
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(1000)

    useCommunityChatStore.getState().markSeen(500)
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(1000)
    useCommunityChatStore.getState().markSeen(2000)
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(2000)
    expect(localStorage.getItem('mira.communityChat.lastSeen:ws1')).toBe('2000')

    useCommunityChatStore.getState().loadForWorkspace('ws2')
    expect(useCommunityChatStore.getState().lastSeenAt).toBe(0)
  })

  it("counts only the agent's messages newer than the last look", () => {
    const logs = [
      entry('older', '2026-10-26T09:00:00Z'),
      entry('new', '2026-10-26T11:00:00Z'),
      entry('mine', '2026-10-26T12:00:00Z', { metadata: { _user: true } }),
      entry('working', '2026-10-26T12:30:00Z', { type: 'progress' }),
      entry('tool', '2026-10-26T12:40:00Z', { type: 'tool_call' }),
    ]
    expect(logs.filter(isAgentMessage).map((e) => e.id)).toEqual(['older', 'new'])
    expect(countUnread(logs, Date.parse('2026-10-26T10:00:00Z'))).toBe(1)
    expect(countUnread(logs, 0)).toBe(2)
    expect(countUnread(undefined, 0)).toBe(0)
    expect(newestAgentMessageAt(logs)).toBe(Date.parse('2026-10-26T11:00:00Z'))
    expect(newestAgentMessageAt([])).toBe(0)
  })
})
