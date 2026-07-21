import { describe, expect, it } from 'vitest'

import {
  NORMAL_CHAT_SESSION_ID,
  isChatSessionId,
  isProjectSessionId,
  newChatSessionId,
} from './sessions'

describe('newChatSessionId', () => {
  it('produces a prefixed, unique id', () => {
    const a = newChatSessionId()
    const b = newChatSessionId()
    expect(a).toMatch(/^chat-/)
    expect(a).not.toBe(b)
    expect(isChatSessionId(a)).toBe(true)
  })
})

describe('isChatSessionId', () => {
  it('matches chat ids and the legacy normal id', () => {
    expect(isChatSessionId('chat-abc')).toBe(true)
    expect(isChatSessionId(NORMAL_CHAT_SESSION_ID)).toBe(true)
  })

  it('rejects project ids and nullish values', () => {
    expect(isChatSessionId('PRJ-0001')).toBe(false)
    expect(isChatSessionId(null)).toBe(false)
    expect(isChatSessionId(undefined)).toBe(false)
  })
})

describe('isProjectSessionId', () => {
  it('matches project ids only', () => {
    expect(isProjectSessionId('PRJ-0001')).toBe(true)
    expect(isProjectSessionId('chat-abc')).toBe(false)
    expect(isProjectSessionId(null)).toBe(false)
  })
})
