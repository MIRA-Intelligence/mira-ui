// Conservative PII scrubbing for free-text feedback. Goal is to catch the
// most common identifiers that medical-domain users might paste in by accident
// (national ID numbers, phone numbers, medical record numbers). Not a
// substitute for the upfront privacy notice in the form.

const PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Mainland China resident ID — 18 digits with optional X check digit, or
  // legacy 15 digits. Anchored with a non-digit boundary to reduce false
  // positives on long numeric tokens.
  {
    pattern: /(?<![\d])(\d{17}[\dXx]|\d{15})(?![\d])/g,
    replacement: '[REDACTED_ID]',
  },
  // Mainland mobile numbers (1 + 10 digits, second digit 3-9).
  {
    pattern: /(?<![\d])1[3-9]\d{9}(?![\d])/g,
    replacement: '[REDACTED_PHONE]',
  },
  // Email addresses.
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
  },
  // Medical record / patient ID hints: the keyword followed by an optional
  // separator and a value. Keeps the keyword so the developer still sees
  // context.
  {
    pattern: /(病历号|病案号|住院号|门诊号|患者编号|MRN|PatientID)[\s:：#]*[A-Za-z0-9-]{3,}/gi,
    replacement: '$1 [REDACTED]',
  },
]

export function scrubText(input: string): string {
  if (!input) return input
  let out = input
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export interface FeedbackEnvelopeInput {
  title: string
  body: string
}

export interface ScrubbedEnvelope {
  title: string
  body: string
}

export function scrubEnvelope(input: FeedbackEnvelopeInput): ScrubbedEnvelope {
  return {
    title: scrubText(input.title),
    body: scrubText(input.body),
  }
}

// Whitelist of metadata fields we are willing to send. Any future addition
// must go through this allowlist explicitly so we cannot accidentally leak
// internal IDs.
const ALLOWED_META_KEYS = new Set([
  'appVersion',
  'os',
  'route',
  'locale',
])

export function pickAllowedMeta<T extends Record<string, unknown>>(meta: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(meta)) {
    if (ALLOWED_META_KEYS.has(key)) {
      out[key] = meta[key]
    }
  }
  return out as Partial<T>
}
