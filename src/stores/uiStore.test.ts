import { describe, expect, it, beforeEach } from 'vitest'

import { useUiStore } from './uiStore'

const initialState = useUiStore.getState()

describe('uiStore.systemMessages', () => {
  beforeEach(() => {
    useUiStore.setState(initialState, true)
  })

  it('pushes a system message and returns its id', () => {
    const id = useUiStore.getState().pushSystemMessage('hello')
    expect(id).toMatch(/^sysmsg-/)
    const msgs = useUiStore.getState().systemMessages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('hello')
    expect(msgs[0].severity).toBe('info')
    expect(msgs[0].expiresAt).toBeGreaterThan(Date.now())
  })

  it('honors custom severity and ttl', () => {
    const before = Date.now()
    useUiStore.getState().pushSystemMessage('warn me', { severity: 'warning', ttlMs: 1000 })
    const msg = useUiStore.getState().systemMessages[0]
    expect(msg.severity).toBe('warning')
    expect(msg.expiresAt).toBeGreaterThanOrEqual(before + 999)
    expect(msg.expiresAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('caps the queue length to prevent unbounded growth', () => {
    const push = useUiStore.getState().pushSystemMessage
    for (let i = 0; i < 50; i += 1) push(`msg-${i}`)
    const msgs = useUiStore.getState().systemMessages
    expect(msgs.length).toBeLessThanOrEqual(16)
    expect(msgs[msgs.length - 1].text).toBe('msg-49')
  })

  it('dismisses a message by id', () => {
    const id = useUiStore.getState().pushSystemMessage('to dismiss')
    useUiStore.getState().dismissSystemMessage(id)
    expect(useUiStore.getState().systemMessages).toHaveLength(0)
  })

  it('clears expired messages', () => {
    useUiStore.getState().pushSystemMessage('soon-expired', { ttlMs: 500 })
    useUiStore.getState().pushSystemMessage('still-fresh', { ttlMs: 60_000 })
    useUiStore.getState().clearExpiredSystemMessages(Date.now() + 1000)
    const remaining = useUiStore.getState().systemMessages
    expect(remaining).toHaveLength(1)
    expect(remaining[0].text).toBe('still-fresh')
  })

  it('clearExpiredSystemMessages is a no-op when nothing is expired', () => {
    useUiStore.getState().pushSystemMessage('fresh', { ttlMs: 60_000 })
    const before = useUiStore.getState().systemMessages
    useUiStore.getState().clearExpiredSystemMessages()
    expect(useUiStore.getState().systemMessages).toBe(before)
  })
})
