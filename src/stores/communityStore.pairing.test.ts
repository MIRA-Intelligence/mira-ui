import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/community', () => ({
  fetchCommunityStatus: vi.fn(),
  fetchCommunityInbox: vi.fn(async () => ({ items: [], unread: null })),
  markCommunityInboxRead: vi.fn(),
  setCommunityNotifications: vi.fn(),
  fetchCommunityApprovals: vi.fn(async () => []),
  setCommunityAutonomy: vi.fn(),
  decideCommunityApproval: vi.fn(),
  onboardCommunity: vi.fn(),
  startCommunityPairing: vi.fn(),
  pollCommunityPairing: vi.fn(),
  fetchCommunityProfile: vi.fn(),
  saveCommunityProfile: vi.fn(),
}))

import { useCommunityStore } from './communityStore'
import { useUiStore } from './uiStore'
import type { CommunityStatus } from '@/services/community'
import {
  fetchCommunityInbox,
  fetchCommunityProfile,
  fetchCommunityStatus,
  saveCommunityProfile,
  markCommunityInboxRead,
  pollCommunityPairing,
  setCommunityAutonomy,
  setCommunityNotifications,
  startCommunityPairing,
} from '@/services/community'

const status = (profile_onboarded?: boolean): CommunityStatus => ({
  enabled: true, logged_in: true, agent_id: 'a1', api_base: 'http://x', autonomy_mode: 'hitl',
  code_host: 'github', domains: ['rag'], pending_count: 0, member_status: 'pending', profile_onboarded,
})

async function joinAndAuthorize(profileOnboarded?: boolean) {
  vi.mocked(startCommunityPairing).mockResolvedValue({ user_code: 'C', poll_token: 'p', verification_url: 'u', interval: 1 })
  vi.mocked(pollCommunityPairing).mockResolvedValue({ status: 'authorized', agent_id: 'a1' })
  vi.mocked(fetchCommunityStatus).mockResolvedValue(status(profileOnboarded))
  await useCommunityStore.getState().startPairing({ domains: ['rag'], participation: ['review'] })
  await vi.runAllTimersAsync()
}

describe('community pairing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockImplementation(() => null)
    useUiStore.setState({ onboardingOpen: false })
    useCommunityStore.setState({ status: null, pairing: { active: false, verificationUrl: null, userCode: null, error: null } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('sends the public profile with the pairing request', async () => {
    await joinAndAuthorize(true)
    expect(startCommunityPairing).toHaveBeenCalledWith({ profile: { domains: ['rag'], participation: ['review'] } })
  })

  it('opens the profile wizard after joining when there is no private profile yet', async () => {
    await joinAndAuthorize(false)
    expect(useCommunityStore.getState().status?.logged_in).toBe(true)
    expect(useUiStore.getState().onboardingOpen).toBe(true)
  })

  it('leaves users with a profile (or an older engine) alone', async () => {
    await joinAndAuthorize(true)
    expect(useUiStore.getState().onboardingOpen).toBe(false)
    await joinAndAuthorize(undefined)
    expect(useUiStore.getState().onboardingOpen).toBe(false)
  })

  it('returns to the join form with the reason when pairing cannot start', async () => {
    vi.mocked(startCommunityPairing).mockResolvedValue({ error: 'pairing failed: bio must be a string of at most 500 characters' })
    await useCommunityStore.getState().startPairing({ bio: 'x' })
    const { pairing } = useCommunityStore.getState()
    expect(pairing.active).toBe(false)
    expect(pairing.error).toMatch(/bio must be/)
  })
})

describe('community inbox actions', () => {
  beforeEach(() => {
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: true, agent_id: 'a1', api_base: 'http://x', autonomy_mode: 'hitl', code_host: 'github',
        domains: [], pending_count: 0, notifications: ['reply'], unread: { total: 2, by_kind: { reply: 2, mention: 0, review: 0, work: 0, activity: 0 } },
      },
      inbox: [
        { id: 'a', kind: 'reply', type: 'reply', title: 'A', body: '', from: '', thread_id: '', url: '', created_at: '', read: false },
        { id: 'b', kind: 'reply', type: 'reply', title: 'B', body: '', from: '', thread_id: '', url: '', created_at: '', read: false },
      ],
      error: null,
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('marks read at once and then takes the engine counts', async () => {
    const counts = { total: 1, by_kind: { reply: 1, mention: 0, review: 0, work: 0, activity: 0 } }
    vi.mocked(markCommunityInboxRead).mockResolvedValue({ ok: true, unread: counts })
    const done = useCommunityStore.getState().markRead({ ids: ['a'] })
    expect(useCommunityStore.getState().inbox.map((i) => i.read)).toEqual([true, false])
    await done
    expect(useCommunityStore.getState().status?.unread).toEqual(counts)
  })

  it('saves the notification choice', async () => {
    vi.mocked(setCommunityNotifications).mockResolvedValue({ ok: true, notifications: [] })
    await useCommunityStore.getState().setNotifications([])
    expect(setCommunityNotifications).toHaveBeenCalledWith([])
    expect(useCommunityStore.getState().status?.notifications).toEqual([])
  })

  it('refresh loads the inbox with the status', async () => {
    vi.mocked(fetchCommunityStatus).mockResolvedValue(status(true))
    vi.mocked(fetchCommunityInbox).mockResolvedValue({
      items: [{ id: 'z', kind: 'mention', type: 'mention', title: 'Z', body: '', from: '', thread_id: '', url: '', created_at: '', read: false }],
      unread: { total: 1, by_kind: { reply: 0, mention: 1, review: 0, work: 0, activity: 0 } },
    })
    await useCommunityStore.getState().refresh()
    expect(useCommunityStore.getState().inbox.map((i) => i.id)).toEqual(['z'])
    expect(useCommunityStore.getState().status?.unread?.total).toBe(1)
  })
})

describe('switching the autonomy mode', () => {
  afterEach(() => vi.clearAllMocks())

  it('keeps what the engine leaves out of its answer (no false "connection test" banner)', async () => {
    useCommunityStore.setState({ status: { ...status(true), member_status: 'active', web_url: 'http://web', pending_count: 2 } })
    // The engine's autonomy endpoint returns only its config fields.
    const { member_status: _m, web_url: _w, unread: _u, pending_count: _p, ...configOnly } = status(true)
    vi.mocked(setCommunityAutonomy).mockResolvedValue({ ...configOnly, autonomy_mode: 'fully_autonomous' } as never)
    await useCommunityStore.getState().setAutonomy('fully_autonomous')
    const s = useCommunityStore.getState().status
    expect(s?.autonomy_mode).toBe('fully_autonomous')
    expect(s?.member_status).toBe('active')
    expect(s?.web_url).toBe('http://web')
    expect(s?.pending_count).toBe(2)
  })
})

describe('the agent profile', () => {
  const data = {
    agent_id: 'a1',
    name: 'Nova',
    profile: { domains: ['plugins'], tech_stack: [], languages: [], participation: ['answer' as const], bio: null },
  }
  beforeEach(() => {
    useCommunityStore.setState({ status: { ...status(true), agent_name: 'Old' }, profile: { data: null, phase: 'idle', error: null } })
  })
  afterEach(() => vi.clearAllMocks())

  it('loads it, or keeps the error', async () => {
    vi.mocked(fetchCommunityProfile).mockResolvedValueOnce({ ok: false, error: 'not logged in' })
    await useCommunityStore.getState().loadProfile()
    expect(useCommunityStore.getState().profile).toEqual({ data: null, phase: 'error', error: 'not logged in' })
    vi.mocked(fetchCommunityProfile).mockResolvedValueOnce({ ok: true, data })
    await useCommunityStore.getState().loadProfile()
    expect(useCommunityStore.getState().profile).toEqual({ data, phase: 'idle', error: null })
  })

  it('saving updates the profile and the name and areas in the status', async () => {
    vi.mocked(saveCommunityProfile).mockResolvedValue({ ok: true, data })
    expect(await useCommunityStore.getState().saveProfile({ name: 'Nova' })).toBe(true)
    expect(saveCommunityProfile).toHaveBeenCalledWith({ name: 'Nova' })
    const s = useCommunityStore.getState()
    expect(s.profile.phase).toBe('saved')
    expect(s.status?.agent_name).toBe('Nova')
    expect(s.status?.domains).toEqual(['plugins'])
  })

  it('a refused save keeps the old profile and status', async () => {
    useCommunityStore.setState({ profile: { data, phase: 'idle', error: null } })
    vi.mocked(saveCommunityProfile).mockResolvedValue({ ok: false, error: 'name: not allowed' })
    expect(await useCommunityStore.getState().saveProfile({ name: 'X' })).toBe(false)
    const s = useCommunityStore.getState()
    expect(s.profile).toEqual({ data, phase: 'error', error: 'name: not allowed' })
    expect(s.status?.agent_name).toBe('Old')
  })
})
