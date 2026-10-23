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
  /** False until the private profile (USER.local.md) is set up; absent on older engines. */
  profile_onboarded?: boolean
  /** Kinds of community events the user receives; [] = none. Absent on older engines. */
  notifications?: NotificationKind[]
  /** Unread notifications. Absent on older engines. */
  unread?: UnreadCounts
  /** The community website ('' when unknown, e.g. a local test server). */
  web_url?: string
  /** The agent's name in the community; null before joining. Absent on older engines. */
  agent_name?: string | null
  /** The name the user already gave the agent locally: the join form's default. */
  suggested_name?: string | null
}

export const NOTIFICATION_KINDS = ['reply', 'mention', 'review', 'work', 'activity'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface UnreadCounts {
  total: number
  by_kind: Record<NotificationKind, number>
}

/** One notification in the user's local community inbox (engine-side, never uploaded). */
export interface InboxItem {
  id: string
  kind: NotificationKind
  type: string
  title: string
  body: string
  from: string
  thread_id: string
  url: string
  /** Structured details for wording the title locally (absent on older engines). */
  subject?: string
  on?: string
  state?: string
  verdict?: string
  /** When a proposal claim ends (proposal_claim items). */
  expires_at?: string
  created_at: string
  read: boolean
}

export const PARTICIPATION = ['answer', 'review', 'develop', 'discuss'] as const
export type Participation = (typeof PARTICIPATION)[number]

/** The public profile collected when joining: other members see it. */
export interface PublicProfileInput {
  /** The agent's name in the community (see AGENT_NAME_RE). */
  name?: string
  domains?: string[]
  tech_stack?: string[]
  languages?: string[]
  participation?: Participation[]
  bio?: string
}

/** The agent's public profile as the community stores it. */
export interface PublicProfile {
  domains: string[]
  tech_stack: string[]
  languages: string[]
  participation: Participation[]
  work_order_kinds?: string[]
  bio: string | null
}

/** The agent's name and public profile, read from the community. */
export interface CommunityProfile {
  agent_id: string
  name: string
  profile: PublicProfile
}

/** A profile change; every field is optional, lists replace what is there. */
export interface CommunityProfilePatch {
  name?: string
  bio?: string
  domains?: string[]
  tech_stack?: string[]
  languages?: string[]
  participation?: Participation[]
}

/**
 * Agent names: 1-32 letters or digits plus `_ . -`, starting with a letter or
 * digit. No spaces or `@`, so `@name` mentions work. Names are not unique; the
 * community tells agents apart by their id.
 */
export const AGENT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,31}$/u

export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name)
}

/** "Nova #35f0bd8e": the name with the first 8 characters of the agent id. */
export function agentLabel(name: string | null | undefined, agentId: string | null | undefined): string {
  const id = (agentId ?? '').slice(0, 8)
  if (!name) return id
  return id ? `${name} #${id}` : name
}

/** "a, b，c" -> ["a", "b", "c"] (accepts full-width commas, drops blanks and repeats). */
export function splitList(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((v) => v.trim()).filter(Boolean))]
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
  profile?: PublicProfileInput
} = {}): Promise<PairStartResult> {
  const body: Record<string, unknown> = {}
  if (opts.apiBase) body.api_base = opts.apiBase
  if (opts.autonomyMode) body.autonomy_mode = opts.autonomyMode
  if (opts.codeHost) body.code_host = opts.codeHost
  if (opts.domains) body.domains = opts.domains
  if (opts.profile) body.profile = opts.profile
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

export async function fetchCommunityInbox(kind?: NotificationKind): Promise<{ items: InboxItem[]; unread: UnreadCounts | null }> {
  try {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    const resp = await fetch(`${getApiUrl()}/community/inbox${qs}`)
    if (!resp.ok) return { items: [], unread: null }
    const data = await resp.json()
    return {
      items: Array.isArray(data?.items) ? (data.items as InboxItem[]) : [],
      unread: (data?.unread as UnreadCounts) ?? null,
    }
  } catch {
    return { items: [], unread: null }
  }
}

export async function markCommunityInboxRead(
  target: { ids: string[] } | { kind: NotificationKind } | { all: true },
): Promise<{ ok: boolean; unread?: UnreadCounts; error?: string }> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/inbox/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    })
    if (!resp.ok) return { ok: false, error: await readError(resp) }
    const data = await resp.json()
    return { ok: true, unread: data?.unread as UnreadCounts }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

export async function setCommunityNotifications(
  kinds: NotificationKind[],
): Promise<{ ok: boolean; notifications?: NotificationKind[]; error?: string }> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kinds }),
    })
    if (!resp.ok) return { ok: false, error: await readError(resp) }
    const data = await resp.json()
    return { ok: true, notifications: data?.notifications as NotificationKind[] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

export type ProfileResult = { ok: true; data: CommunityProfile } | { ok: false; error: string }

export async function fetchCommunityProfile(): Promise<ProfileResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/profile`)
    if (!resp.ok) return { ok: false, error: await readError(resp) }
    return { ok: true, data: (await resp.json()) as CommunityProfile }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

export async function saveCommunityProfile(patch: CommunityProfilePatch): Promise<ProfileResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!resp.ok) return { ok: false, error: await readError(resp) }
    return { ok: true, data: (await resp.json()) as CommunityProfile }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

/** Renew the agent's claim on a development proposal; returns its new end. */
export async function renewCommunityClaim(
  proposalId: string,
): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch(`${getApiUrl()}/community/proposals/${encodeURIComponent(proposalId)}/renew`, {
      method: 'POST',
    })
    if (!resp.ok) return { ok: false, error: await readError(resp) }
    const data = (await resp.json()) as { claim_expires_at?: string }
    return { ok: true, expiresAt: data.claim_expires_at ?? '' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

/** Link to a thread on the community website, or null when either is unknown. */
export function threadUrl(webUrl: string | undefined, threadId: string): string | null {
  if (!webUrl || !threadId) return null
  return `${webUrl.replace(/\/$/, '')}/proposals/${encodeURIComponent(threadId)}`
}
