import { useSettingsStore } from '@/stores/settingsStore'

export type AutonomyMode = 'fully_autonomous' | 'hitl' | 'hybrid'

export interface CommunityStatus {
  enabled: boolean
  logged_in: boolean
  agent_id: string
  api_base: string
  autonomy_mode: AutonomyMode
  code_host: 'github' | 'cnb'
  domains: string[]
  pending_count: number
  /** Server-side lifecycle status (pending/active/suspended), null if unknown. */
  member_status?: 'pending' | 'active' | 'suspended' | null
}

export interface OnboardResult {
  ok: boolean
  /** True when the agent was nudged to compose and post its welcome reply. */
  triggered?: boolean
  /** True when already onboarded / already replied — nothing to do. */
  already?: boolean
  /** True when a welcome reply is already in flight (de-bounced). */
  pending?: boolean
  status?: string | null
  error?: string
}

export interface CommunityApproval {
  id: string
  action: string
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  decided_at?: string
}

export interface PairStartResult {
  verification_url?: string
  user_code?: string
  poll_token?: string
  interval?: number
  expires_in?: number
  error?: string
}

export type PairPollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'authorized'; agent_id: string }
  | { status: 'error'; error: string }

function getApiUrl(): string {
  return useSettingsStore.getState().apiUrl
}

async function readError(resp: Response): Promise<string> {
  try {
    const data = await resp.json()
    if (data && typeof data.error === 'string') return data.error
  } catch {
    // fall through
  }
  return `request failed (${resp.status})`
}

export async function fetchCommunityStatus(): Promise<CommunityStatus | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/status`)
    if (!resp.ok) return null
    return (await resp.json()) as CommunityStatus
  } catch {
    return null
  }
}

export async function setCommunityAutonomy(mode: AutonomyMode): Promise<CommunityStatus> {
  const resp = await fetch(`${getApiUrl()}/community/autonomy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!resp.ok) throw new Error(await readError(resp))
  return (await resp.json()) as CommunityStatus
}

export async function onboardCommunity(): Promise<OnboardResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: data?.error ?? `onboarding failed (${resp.status})` }
    return data as OnboardResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

export async function fetchCommunityApprovals(
  status?: CommunityApproval['status'],
): Promise<CommunityApproval[]> {
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    const resp = await fetch(`${getApiUrl()}/community/approvals${qs}`)
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data?.approvals) ? (data.approvals as CommunityApproval[]) : []
  } catch {
    return []
  }
}

export async function decideCommunityApproval(
  id: string,
  decision: 'approve' | 'reject',
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(
    `${getApiUrl()}/community/approvals/${encodeURIComponent(id)}/decide`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
  )
  if (!resp.ok) return { ok: false, error: await readError(resp) }
  return { ok: true }
}

export async function startCommunityPairing(opts: {
  apiBase?: string
  autonomyMode?: AutonomyMode
  codeHost?: 'github' | 'cnb'
  domains?: string[]
} = {}): Promise<PairStartResult> {
  const body: Record<string, unknown> = {}
  if (opts.apiBase) body.api_base = opts.apiBase
  if (opts.autonomyMode) body.autonomy_mode = opts.autonomyMode
  if (opts.codeHost) body.code_host = opts.codeHost
  if (opts.domains) body.domains = opts.domains
  const resp = await fetch(`${getApiUrl()}/community/pair/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) return { error: await readError(resp) }
  return (await resp.json()) as PairStartResult
}

export async function pollCommunityPairing(pollToken: string): Promise<PairPollResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/pair/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_token: pollToken }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { status: 'error', error: data?.error ?? `poll failed (${resp.status})` }
    if (data?.status === 'authorized') {
      return { status: 'authorized', agent_id: data.agent_id ?? '' }
    }
    if (data?.status === 'expired') return { status: 'expired' }
    return { status: 'pending' }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'network error' }
  }
}
