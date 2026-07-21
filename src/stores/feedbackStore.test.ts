import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installLocalStorage } from '@/test/localStorage'

vi.mock('@/services/feedback', () => ({
  flushPendingQueue: vi.fn().mockResolvedValue(undefined),
  getActiveChannelId: vi.fn(() => 'feishu'),
  pendingQueueLength: vi.fn(() => 0),
  submitFeedback: vi.fn(),
}))

import * as feedback from '@/services/feedback'
import { useFeedbackStore } from './feedbackStore'

const mocked = feedback as unknown as Record<string, ReturnType<typeof vi.fn>>
const initial = useFeedbackStore.getState()

const baseInput = {
  type: 'bug' as const,
  severity: null,
  title: 'T',
  body: 'B',
  contact: null,
  route: '/chat',
  locale: 'en',
}

describe('feedbackStore', () => {
  beforeEach(() => {
    installLocalStorage()
    vi.clearAllMocks()
    mocked.getActiveChannelId.mockReturnValue('feishu')
    mocked.pendingQueueLength.mockReturnValue(0)
    useFeedbackStore.setState(initial, true)
    useFeedbackStore.setState({
      dialogOpen: false,
      submissionState: 'idle',
      errorMessage: null,
      success: null,
      pendingCount: 0,
      recentSubmits: [],
      channelOverrides: { feishu: null, slack: null },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openDialog and closeDialog toggle dialog state', () => {
    useFeedbackStore.getState().openDialog()
    expect(useFeedbackStore.getState().dialogOpen).toBe(true)
    useFeedbackStore.getState().closeDialog()
    expect(useFeedbackStore.getState().dialogOpen).toBe(false)
  })

  it('resetForm clears submission state', () => {
    useFeedbackStore.setState({ submissionState: 'error', errorMessage: 'x' })
    useFeedbackStore.getState().resetForm()
    expect(useFeedbackStore.getState().submissionState).toBe('idle')
    expect(useFeedbackStore.getState().errorMessage).toBeNull()
  })

  it('setOverride persists overrides to localStorage', () => {
    useFeedbackStore.getState().setOverride('feishu', { webhookUrl: 'https://hook' })
    expect(useFeedbackStore.getState().channelOverrides.feishu).toEqual({ webhookUrl: 'https://hook' })
    const stored = JSON.parse(localStorage.getItem('medpilot-feedback-overrides') || '{}')
    expect(stored.feishu.webhookUrl).toBe('https://hook')
  })

  it('submit records success info', async () => {
    mocked.submitFeedback.mockResolvedValueOnce({ ok: true, channel: 'feishu', inviteUrl: 'invite' })
    const outcome = await useFeedbackStore.getState().submit(baseInput)
    expect(outcome.ok).toBe(true)
    expect(useFeedbackStore.getState().submissionState).toBe('success')
    expect(useFeedbackStore.getState().success).toEqual({ channel: 'feishu', inviteUrl: 'invite' })
  })

  it('submit reflects a queued failure', async () => {
    mocked.submitFeedback.mockResolvedValueOnce({ ok: false, channel: 'feishu', error: 'offline', queued: true })
    await useFeedbackStore.getState().submit(baseInput)
    expect(useFeedbackStore.getState().submissionState).toBe('queued')
    expect(useFeedbackStore.getState().errorMessage).toBe('offline')
  })

  it('submit throttles after 3 submissions in the window', async () => {
    mocked.submitFeedback.mockResolvedValue({ ok: true, channel: 'feishu', inviteUrl: null })
    await useFeedbackStore.getState().submit(baseInput)
    await useFeedbackStore.getState().submit(baseInput)
    await useFeedbackStore.getState().submit(baseInput)
    const outcome = await useFeedbackStore.getState().submit(baseInput)
    expect(outcome).toEqual({ ok: false, channel: null, error: 'throttled', queued: false })
    expect(useFeedbackStore.getState().submissionState).toBe('error')
    expect(mocked.submitFeedback).toHaveBeenCalledTimes(3)
  })

  it('flushPending refreshes the pending count', async () => {
    mocked.pendingQueueLength.mockReturnValue(2)
    await useFeedbackStore.getState().flushPending()
    expect(mocked.flushPendingQueue).toHaveBeenCalled()
    expect(useFeedbackStore.getState().pendingCount).toBe(2)
  })
})
