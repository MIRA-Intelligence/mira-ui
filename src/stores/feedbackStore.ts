import { create } from 'zustand'
import {
  flushPendingQueue,
  getActiveChannelId,
  pendingQueueLength,
  submitFeedback,
} from '@/services/feedback'
import type {
  FeedbackChannelConfig,
  FeedbackChannelId,
  FeedbackContact,
  FeedbackSeverity,
  FeedbackSubmitOutcome,
  FeedbackType,
} from '@/services/feedback/types'

const OVERRIDE_STORAGE_KEY = 'medpilot-feedback-overrides'
const THROTTLE_WINDOW_MS = 60_000
const THROTTLE_MAX = 3

type SubmissionState = 'idle' | 'sending' | 'success' | 'queued' | 'error'

interface SuccessInfo {
  channel: FeedbackChannelId
  inviteUrl: string | null
}

interface SubmitInput {
  type: FeedbackType
  severity: FeedbackSeverity | null
  title: string
  body: string
  contact: FeedbackContact | null
  route: string
  locale: string
}

interface FeedbackState {
  dialogOpen: boolean
  submissionState: SubmissionState
  errorMessage: string | null
  success: SuccessInfo | null
  pendingCount: number
  recentSubmits: number[]
  channelOverrides: Record<FeedbackChannelId, FeedbackChannelConfig | null>
  openDialog: () => void
  closeDialog: () => void
  resetForm: () => void
  submit: (input: SubmitInput) => Promise<FeedbackSubmitOutcome>
  flushPending: () => Promise<void>
  setOverride: (channel: FeedbackChannelId, config: FeedbackChannelConfig | null) => void
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function loadOverrides(): Record<FeedbackChannelId, FeedbackChannelConfig | null> {
  const empty: Record<FeedbackChannelId, FeedbackChannelConfig | null> = {
    feishu: null,
    slack: null,
  }
  const ls = safeLocalStorage()
  if (!ls) return empty
  try {
    const raw = ls.getItem(OVERRIDE_STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return empty
    return {
      feishu: sanitizeOverride(parsed.feishu),
      slack: sanitizeOverride(parsed.slack),
    }
  } catch {
    return empty
  }
}

function sanitizeOverride(value: unknown): FeedbackChannelConfig | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const out: FeedbackChannelConfig = {}
  if (typeof v.webhookUrl === 'string') out.webhookUrl = v.webhookUrl
  if (typeof v.secret === 'string') out.secret = v.secret
  if (typeof v.inviteUrl === 'string') out.inviteUrl = v.inviteUrl
  return Object.keys(out).length > 0 ? out : null
}

function persistOverrides(state: FeedbackState['channelOverrides']): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try { ls.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function isThrottled(history: number[], now: number): boolean {
  const cutoff = now - THROTTLE_WINDOW_MS
  const recent = history.filter((t) => t > cutoff)
  return recent.length >= THROTTLE_MAX
}

function trimHistory(history: number[], now: number): number[] {
  const cutoff = now - THROTTLE_WINDOW_MS
  return history.filter((t) => t > cutoff)
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  dialogOpen: false,
  submissionState: 'idle',
  errorMessage: null,
  success: null,
  pendingCount: pendingQueueLength(),
  recentSubmits: [],
  channelOverrides: loadOverrides(),

  openDialog: () => set({
    dialogOpen: true,
    submissionState: 'idle',
    errorMessage: null,
    success: null,
  }),

  closeDialog: () => set({ dialogOpen: false }),

  resetForm: () => set({
    submissionState: 'idle',
    errorMessage: null,
    success: null,
  }),

  submit: async (input) => {
    const state = get()
    const now = Date.now()
    const history = trimHistory(state.recentSubmits, now)
    if (isThrottled(history, now)) {
      const outcome: FeedbackSubmitOutcome = {
        ok: false,
        channel: null,
        error: 'throttled',
        queued: false,
      }
      set({
        submissionState: 'error',
        errorMessage: 'throttled',
        recentSubmits: history,
      })
      return outcome
    }

    set({
      submissionState: 'sending',
      errorMessage: null,
      success: null,
    })

    const channelId = getActiveChannelId()
    const override = state.channelOverrides[channelId] ?? null
    const outcome = await submitFeedback({ ...input, override }, { override })

    const nextHistory = trimHistory([...history, now], now)
    const pendingCount = pendingQueueLength()
    if (outcome.ok) {
      set({
        submissionState: 'success',
        errorMessage: null,
        success: { channel: outcome.channel, inviteUrl: outcome.inviteUrl },
        recentSubmits: nextHistory,
        pendingCount,
      })
    } else {
      set({
        submissionState: outcome.queued ? 'queued' : 'error',
        errorMessage: outcome.error,
        success: null,
        recentSubmits: nextHistory,
        pendingCount,
      })
    }
    return outcome
  },

  flushPending: async () => {
    const state = get()
    const channelId = getActiveChannelId()
    const override = state.channelOverrides[channelId] ?? null
    await flushPendingQueue(override)
    set({ pendingCount: pendingQueueLength() })
  },

  setOverride: (channel, config) => {
    const next = { ...get().channelOverrides, [channel]: config }
    persistOverrides(next)
    set({ channelOverrides: next })
  },
}))
