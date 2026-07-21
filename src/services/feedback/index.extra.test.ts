import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installLocalStorage } from '@/test/localStorage'

vi.mock('@/services/api', () => ({
  fetchFeedbackConfig: vi.fn(),
  submitFeedbackReport: vi.fn(),
}))

import * as api from '@/services/api'
import {
  clearQueue,
  queueLength,
} from './queue'
import {
  fetchInviteUrl,
  flushPendingQueue,
  getActiveChannelId,
  getInviteUrl,
  pendingQueueLength,
  setActiveChannel,
  submitFeedback,
} from './index'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const validInput = {
  type: 'bug' as const,
  severity: 'normal' as const,
  title: 'Crash on open',
  body: 'It crashes when I open a project.',
  contact: { kind: 'email' as const, value: ' me@x.com ' },
  route: '/chat',
  locale: 'en',
}

describe('feedback service (full paths)', () => {
  beforeEach(() => {
    installLocalStorage()
    vi.clearAllMocks()
    clearQueue()
    setActiveChannel('feishu')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks the active channel', () => {
    setActiveChannel('slack')
    expect(getActiveChannelId()).toBe('slack')
  })

  it('rejects empty submissions as invalid', async () => {
    const outcome = await submitFeedback({ ...validInput, title: '   ', body: '' })
    expect(outcome).toEqual({ ok: false, channel: null, error: 'invalid', queued: false })
    expect(mocked.fetchFeedbackConfig).not.toHaveBeenCalled()
  })

  it('returns not_configured when the relay is unavailable', async () => {
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: false, inviteUrl: null })
    const outcome = await submitFeedback(validInput)
    expect(outcome).toEqual({ ok: false, channel: null, error: 'not_configured', queued: false })
  })

  it('submits successfully and returns the invite url', async () => {
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: null })
    mocked.submitFeedbackReport.mockResolvedValueOnce({ inviteUrl: 'https://invite' })
    const outcome = await submitFeedback(validInput)
    expect(outcome).toEqual({ ok: true, channel: 'feishu', inviteUrl: 'https://invite' })
    // payload should be scrubbed + trimmed contact
    const payload = mocked.submitFeedbackReport.mock.calls[0][0]
    expect(payload.contact).toEqual({ kind: 'email', value: 'me@x.com' })
    expect(payload.id).toMatch(/^fb_/)
    expect(queueLength()).toBe(0)
  })

  it('queues the report when delivery fails', async () => {
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: null })
    mocked.submitFeedbackReport.mockRejectedValueOnce(new Error('network down'))
    const outcome = await submitFeedback(validInput)
    expect(outcome).toEqual({ ok: false, channel: 'feishu', error: 'network down', queued: true })
    expect(queueLength()).toBe(1)
  })

  it('flushPendingQueue is a no-op when not configured', async () => {
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: false, inviteUrl: null })
    await flushPendingQueue()
    expect(mocked.submitFeedbackReport).not.toHaveBeenCalled()
  })

  it('flushPendingQueue drains queued reports when configured', async () => {
    // first: queue a failed report
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: null })
    mocked.submitFeedbackReport.mockRejectedValueOnce(new Error('temporary'))
    await submitFeedback(validInput)
    expect(queueLength()).toBe(1)

    // then: flush succeeds
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: null })
    mocked.submitFeedbackReport.mockResolvedValueOnce({ inviteUrl: null })
    await flushPendingQueue()
    expect(queueLength()).toBe(0)
    expect(pendingQueueLength()).toBe(0)
  })

  it('exposes invite urls', async () => {
    expect(getInviteUrl()).toContain('feishu.cn')
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: 'https://real-invite' })
    expect(await fetchInviteUrl()).toBe('https://real-invite')
    mocked.fetchFeedbackConfig.mockResolvedValueOnce({ configured: true, inviteUrl: null })
    expect(await fetchInviteUrl()).toContain('feishu.cn')
  })
})
