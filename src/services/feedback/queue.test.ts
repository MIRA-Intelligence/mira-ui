import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearQueue,
  enqueue,
  flushQueue,
  getQueue,
  queueLength,
} from './queue'
import type { FeedbackPayload } from './types'
import { installLocalStorage } from '@/test/localStorage'

function makePayload(title: string): FeedbackPayload {
  return {
    type: 'bug',
    severity: null,
    title,
    body: 'body',
    contact: null,
    meta: {},
  } as unknown as FeedbackPayload
}

describe('feedback queue', () => {
  beforeEach(() => {
    installLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts empty', () => {
    expect(getQueue()).toEqual([])
    expect(queueLength()).toBe(0)
  })

  it('enqueues entries with attempt/error metadata', () => {
    enqueue(makePayload('a'), 'network down')
    const queue = getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].attempts).toBe(1)
    expect(queue[0].lastError).toBe('network down')
    expect(queueLength()).toBe(1)
  })

  it('clears the queue', () => {
    enqueue(makePayload('a'), 'err')
    clearQueue()
    expect(queueLength()).toBe(0)
  })

  it('caps the queue at 10 most recent entries', () => {
    for (let i = 0; i < 15; i++) enqueue(makePayload(`t${i}`), 'err')
    expect(queueLength()).toBe(10)
    expect(getQueue()[0].payload.title).toBe('t5')
  })

  it('ignores malformed stored data', () => {
    localStorage.setItem('medpilot-feedback-queue', 'not json')
    expect(getQueue()).toEqual([])
  })

  describe('flushQueue', () => {
    it('returns zero result when empty', async () => {
      const send = vi.fn().mockResolvedValue(undefined)
      expect(await flushQueue(send)).toEqual({ attempted: 0, delivered: 0, remaining: 0 })
      expect(send).not.toHaveBeenCalled()
    })

    it('delivers all entries on success', async () => {
      enqueue(makePayload('a'), 'err')
      enqueue(makePayload('b'), 'err')
      const send = vi.fn().mockResolvedValue(undefined)
      const result = await flushQueue(send)
      expect(result).toEqual({ attempted: 2, delivered: 2, remaining: 0 })
      expect(queueLength()).toBe(0)
    })

    it('re-queues failures with incremented attempts', async () => {
      enqueue(makePayload('ok'), 'err')
      enqueue(makePayload('fail'), 'err')
      const send = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('still failing'))
      const result = await flushQueue(send)
      expect(result).toEqual({ attempted: 2, delivered: 1, remaining: 1 })
      const remaining = getQueue()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].payload.title).toBe('fail')
      expect(remaining[0].attempts).toBe(2)
      expect(remaining[0].lastError).toBe('still failing')
    })
  })
})
