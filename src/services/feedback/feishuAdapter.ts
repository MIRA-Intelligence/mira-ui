import type {
  FeedbackChannelAdapter,
  FeedbackChannelConfig,
  FeedbackPayload,
  FeedbackSeverity,
  FeedbackType,
} from './types'

interface FeishuAdapterOptions {
  envWebhookUrl: string
  envSecret: string
  envInviteUrl: string
  override: FeedbackChannelConfig | null
  fetchFn?: typeof fetch
  now?: () => number
}

const FEISHU_TIMEOUT_MS = 8000

export function createFeishuAdapter(options: FeishuAdapterOptions): FeedbackChannelAdapter {
  const fetchImpl = options.fetchFn ?? fetch
  const nowFn = options.now ?? Date.now

  const resolveUrl = () => options.override?.webhookUrl?.trim() || options.envWebhookUrl.trim()
  const resolveSecret = () => options.override?.secret?.trim() || options.envSecret.trim()
  const resolveInvite = () => options.override?.inviteUrl?.trim() || options.envInviteUrl.trim()

  return {
    id: 'feishu',
    isConfigured: () => Boolean(resolveUrl()),
    inviteUrl: () => {
      const v = resolveInvite()
      return v.length > 0 ? v : null
    },
    submit: async (payload) => {
      const url = resolveUrl()
      if (!url) throw new Error('feishu webhook url not configured')

      const secret = resolveSecret()
      const timestampSec = Math.floor(nowFn() / 1000).toString()
      const card = buildCard(payload)
      const body: Record<string, unknown> = {
        msg_type: 'interactive',
        card,
      }

      if (secret) {
        body.timestamp = timestampSec
        body.sign = await computeFeishuSign(timestampSec, secret)
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FEISHU_TIMEOUT_MS)
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`feishu webhook returned ${response.status}`)
        }
        // Feishu's bot endpoint returns { code, msg } in 200 — treat non-zero
        // code as failure so misconfigured signing surfaces immediately.
        const text = await response.text()
        if (text.length > 0) {
          try {
            const parsed = JSON.parse(text) as { code?: number; msg?: string }
            if (typeof parsed.code === 'number' && parsed.code !== 0) {
              throw new Error(`feishu webhook error ${parsed.code}: ${parsed.msg ?? 'unknown'}`)
            }
          } catch (parseErr) {
            // If parsing fails but the HTTP status was OK, accept the result —
            // the bot may be a relay that does not return JSON.
            if (parseErr instanceof Error && parseErr.message.startsWith('feishu webhook error')) {
              throw parseErr
            }
          }
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

// ── Card builder ────────────────────────────────────────────────────────────

const SEVERITY_TEMPLATE: Record<FeedbackSeverity, string> = {
  blocker: 'red',
  critical: 'orange',
  normal: 'blue',
  minor: 'grey',
}

const TYPE_PREFIX: Record<FeedbackType, string> = {
  bug: 'Bug',
  feature: 'Feature',
  question: 'Question',
  other: 'Other',
}

const SEVERITY_LABEL_ZH: Record<FeedbackSeverity, string> = {
  blocker: '阻塞',
  critical: '严重',
  normal: '一般',
  minor: '轻微',
}

function escapeMd(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
}

function buildHeader(payload: FeedbackPayload) {
  const parts: string[] = [`[${TYPE_PREFIX[payload.type]}`]
  if (payload.severity) {
    parts[0] += ` · ${SEVERITY_LABEL_ZH[payload.severity]}`
  }
  parts[0] += ']'
  parts.push(payload.title.slice(0, 80))
  const template = payload.severity ? SEVERITY_TEMPLATE[payload.severity] : 'blue'
  return {
    title: { tag: 'plain_text', content: parts.join(' ') },
    template,
  }
}

function buildMetaLine(payload: FeedbackPayload): string {
  const segments = [
    `**用户**: ${escapeMd(payload.clientHandle)}`,
    `**版本**: ${escapeMd(payload.appVersion)}`,
    `**OS**: ${escapeMd(payload.os)}`,
  ]
  if (payload.route) segments.push(`**页面**: ${escapeMd(payload.route)}`)
  if (payload.locale) segments.push(`**语言**: ${escapeMd(payload.locale)}`)
  if (payload.contact) {
    segments.push(`**联系**: ${escapeMd(payload.contact.kind)} · ${escapeMd(payload.contact.value)}`)
  }
  return segments.join('  ·  ')
}

function buildCard(payload: FeedbackPayload) {
  return {
    config: { wide_screen_mode: true },
    header: buildHeader(payload),
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: buildMetaLine(payload) },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: payload.body.length > 0 ? escapeMd(payload.body) : '_no description_',
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `feedback_id=${payload.id} · ${payload.createdAt}`,
          },
        ],
      },
    ],
  }
}

// ── HMAC signing ────────────────────────────────────────────────────────────

// Feishu signing: HMAC-SHA256(key=`${timestamp}\n${secret}`, message=empty),
// base64-encoded. Reference:
// https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
export async function computeFeishuSign(timestampSec: string, secret: string): Promise<string> {
  const cryptoObj = getCrypto()
  const stringToSign = `${timestampSec}\n${secret}`
  const keyData = new TextEncoder().encode(stringToSign)
  const key = await cryptoObj.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await cryptoObj.subtle.sign('HMAC', key, new Uint8Array(0))
  return base64Encode(new Uint8Array(sig))
}

function getCrypto(): Crypto {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto
  throw new Error('Web Crypto API unavailable; cannot sign feishu request')
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  if (typeof btoa === 'function') return btoa(bin)
  // Node fallback for environments without btoa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Buf = (globalThis as any).Buffer
  if (Buf) return Buf.from(bytes).toString('base64')
  throw new Error('No base64 encoder available')
}
