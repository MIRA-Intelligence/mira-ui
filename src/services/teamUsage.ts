// Token usage of team providers and per-user token quotas (Mira Server,
// MIRA-Intelligence/mira#157). window.fetch is wrapped by installEngineAuth,
// which adds the access token and refreshes once on 401.

export interface UsageTotals {
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  total_tokens: number
  calls: number
  unreported_calls: number
}

export type QuotaPeriod = 'daily' | 'monthly'

export interface QuotaPeriodStatus {
  limit: number | null
  used: number
  remaining: number | null
  warn: boolean
  exceeded: boolean
  resets_at: string
}

export type QuotaStatus = Record<QuotaPeriod, QuotaPeriodStatus>

export interface UsageRow extends UsageTotals {
  user?: string
  day?: string
  month?: string
  provider?: string
  model?: string
  quota?: QuotaStatus
}

export interface MyUsage {
  user: string
  day: string
  today: UsageTotals
  month: UsageTotals
  by_model: UsageRow[]
  quota: QuotaStatus
  warn_percent: number
}

export interface UsageReport {
  from: string
  to: string
  group_by: string[]
  rows: UsageRow[]
  totals: UsageTotals
}

// null: unlimited (default) or "follow the team default" (a user override); 0 in
// an override: unlimited for that user.
export interface QuotaLimits {
  daily: number | null
  monthly: number | null
}

export interface QuotaSettings {
  default: QuotaLimits
  users: Record<string, QuotaLimits>
  warn_percent: number
}

export class TeamUsageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(origin: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const message = typeof body?.message === 'string' && body.message ? body.message : `HTTP ${response.status}`
    throw new TeamUsageError(message, response.status)
  }
  return body as T
}

export function fetchMyUsage(origin: string): Promise<MyUsage> {
  return request(origin, '/server/usage')
}

export function fetchUsageReport(origin: string, options: { from?: string; to?: string; groupBy?: string[] } = {}):
  Promise<UsageReport> {
  const query = new URLSearchParams()
  if (options.from) query.set('from', options.from)
  if (options.to) query.set('to', options.to)
  if (options.groupBy?.length) query.set('group_by', options.groupBy.join(','))
  const suffix = query.toString()
  return request(origin, `/server/admin/usage${suffix ? `?${suffix}` : ''}`)
}

export async function downloadUsageCsv(origin: string, options: { from: string; to: string; groupBy: string[] }):
  Promise<Blob> {
  const query = new URLSearchParams({ from: options.from, to: options.to, group_by: options.groupBy.join(','),
    format: 'csv' })
  const response = await fetch(`${origin}/server/admin/usage?${query}`, { headers: { Accept: 'text/csv' } })
  if (!response.ok) throw new TeamUsageError(`HTTP ${response.status}`, response.status)
  return response.blob()
}

export function fetchQuotas(origin: string): Promise<QuotaSettings> {
  return request(origin, '/server/admin/quotas')
}

export function saveQuotas(origin: string, settings: QuotaSettings): Promise<QuotaSettings> {
  return request(origin, '/server/admin/quotas', { method: 'PUT', body: JSON.stringify(settings) })
}

// ---------------------------------------------------------------------------
// Token amounts as people write them: 2M, 500k, 1,200,000.

const SUFFIXES: Record<string, number> = { k: 1_000, m: 1_000_000, g: 1_000_000_000 }

const UNLIMITED = new Set(['unlimited', 'none', '不限', '无限'])

// Empty → null; "unlimited" → 0. Returns undefined when the text is not a token amount.
export function parseTokens(text: string): number | null | undefined {
  const value = text.trim().toLowerCase().replace(/[,_\s]/g, '')
  if (!value) return null
  if (UNLIMITED.has(value)) return 0
  const match = value.match(/^(\d+(?:\.\d+)?)([kmg]?)$/)
  if (!match) return undefined
  const amount = Number(match[1]) * (SUFFIXES[match[2]] ?? 1)
  return Number.isInteger(amount) ? amount : undefined
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}G`
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (value >= 10_000) return `${trim(value / 1_000)}k`
  return value.toLocaleString('en-US')
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '')
}
