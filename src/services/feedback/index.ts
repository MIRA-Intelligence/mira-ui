import { getClientId, getDisplayHandle } from '@/lib/clientId'
import { scrubEnvelope } from '@/lib/scrubPayload'
import { enqueue, flushQueue, queueLength } from './queue'
import { fetchFeedbackConfig, submitFeedbackReport } from '@/services/api'
import type {
  FeedbackChannelConfig,
  FeedbackChannelId,
  FeedbackContact,
  FeedbackPayload,
  FeedbackSeverity,
  FeedbackSubmitOutcome,
  FeedbackType,
} from './types'

declare const __APP_VERSION__: string

const DEFAULT_VERSION = (() => {
  try { return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev' }
  catch { return 'dev' }
})()

interface SubmitInput {
  type: FeedbackType
  severity: FeedbackSeverity | null
  title: string
  body: string
  contact: FeedbackContact | null
  route: string
  locale: string
  override?: FeedbackChannelConfig | null
}

let activeAdapterId: FeedbackChannelId = 'feishu'

export function setActiveChannel(id: FeedbackChannelId): void {
  activeAdapterId = id
}

export function getActiveChannelId(): FeedbackChannelId {
  return activeAdapterId
}

function getAppVersion(): string {
  // Prefer build-time injected version; fall back gracefully if unavailable.
  return DEFAULT_VERSION
}

function getOs(): string {
  const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as
    | { platform?: string }
    | undefined
  if (api?.platform) return api.platform
  if (typeof navigator !== 'undefined') {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    return platform.userAgentData?.platform || navigator.platform || 'web'
  }
  return 'unknown'
}

function newFeedbackId(): string {
  const stamp = Date.now().toString(36)
  const tail = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
  return `fb_${stamp}_${tail}`
}

function buildPayload(input: SubmitInput): FeedbackPayload {
  const scrubbed = scrubEnvelope({ title: input.title.trim(), body: input.body.trim() })
  return {
    id: newFeedbackId(),
    clientId: getClientId(),
    clientHandle: getDisplayHandle(),
    type: input.type,
    severity: input.type === 'bug' ? input.severity : null,
    title: scrubbed.title,
    body: scrubbed.body,
    contact: input.contact && input.contact.value.trim().length > 0
      ? { kind: input.contact.kind, value: input.contact.value.trim() }
      : null,
    appVersion: getAppVersion(),
    os: getOs(),
    route: input.route.slice(0, 200),
    locale: input.locale,
    createdAt: new Date().toISOString(),
  }
}

export interface SubmitFeedbackOptions {
  override?: FeedbackChannelConfig | null
}

export async function submitFeedback(
  input: SubmitInput,
  options: SubmitFeedbackOptions = {},
): Promise<FeedbackSubmitOutcome> {
  void options
  if (input.title.trim().length === 0 || input.body.trim().length === 0) {
    return { ok: false, channel: null, error: 'invalid', queued: false }
  }
  const payload = buildPayload(input)
  try {
    const result = await submitFeedbackReport(payload)
    return { ok: true, channel: activeAdapterId, inviteUrl: result.inviteUrl }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    if (errorMessage === 'not_configured') {
      return { ok: false, channel: null, error: 'not_configured', queued: false }
    }
    enqueue(payload, errorMessage)
    return { ok: false, channel: activeAdapterId, error: errorMessage, queued: true }
  }
}

export async function flushPendingQueue(
  _override?: FeedbackChannelConfig | null,
): Promise<void> {
  const config = await fetchFeedbackConfig()
  if (!config.configured) return
  await flushQueue((payload) => submitFeedbackReport(payload).then(() => undefined))
}

export function pendingQueueLength(): number {
  return queueLength()
}

// Promo / "join our group" link shown at the bottom of the feedback form.
// Falls back to a placeholder so the promo block always renders even when the
// backend relay has no public invite URL configured.
const DEFAULT_INVITE_PLACEHOLDER =
  'https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=PLACEHOLDER'

export function getInviteUrl(override?: FeedbackChannelConfig | null): string {
  void override
  return DEFAULT_INVITE_PLACEHOLDER
}

export async function fetchInviteUrl(): Promise<string> {
  const config = await fetchFeedbackConfig()
  return config.inviteUrl ?? DEFAULT_INVITE_PLACEHOLDER
}

export type { FeedbackChannelConfig, FeedbackPayload, FeedbackSubmitOutcome }
