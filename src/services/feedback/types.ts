export type FeedbackType = 'bug' | 'feature' | 'question' | 'other'

export type FeedbackSeverity = 'blocker' | 'critical' | 'normal' | 'minor'

export type FeedbackContactKind = 'wechat' | 'phone' | 'email'

export type FeedbackChannelId = 'feishu' | 'slack'

export interface FeedbackContact {
  kind: FeedbackContactKind
  value: string
}

export interface FeedbackPayload {
  id: string
  clientId: string
  clientHandle: string
  type: FeedbackType
  severity: FeedbackSeverity | null
  title: string
  body: string
  contact: FeedbackContact | null
  appVersion: string
  os: string
  route: string
  locale: string
  createdAt: string
}

export interface FeedbackChannelConfig {
  webhookUrl?: string
  secret?: string
  inviteUrl?: string
}

export interface FeedbackChannelAdapter {
  id: FeedbackChannelId
  isConfigured(): boolean
  submit(payload: FeedbackPayload): Promise<void>
  inviteUrl(): string | null
}

export type FeedbackSubmitOutcome =
  | { ok: true; channel: FeedbackChannelId; inviteUrl: string | null }
  | { ok: false; channel: FeedbackChannelId; error: string; queued: boolean }
  | { ok: false; channel: null; error: 'throttled' | 'not_configured' | 'invalid'; queued: false }
