import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCommunityStore } from './communityStore'
import type { CommunityApproval, CommunityStatus } from '@/services/community'

vi.mock('@/services/community', () => ({
  fetchCommunityStatus: vi.fn(),
  fetchCommunityApprovals: vi.fn(),
  setCommunityAutonomy: vi.fn(),
  decideCommunityApproval: vi.fn(),
  startCommunityPairing: vi.fn(),
  pollCommunityPairing: vi.fn(),
}))

import {
  decideCommunityApproval,
  fetchCommunityApprovals,
  fetchCommunityStatus,
  setCommunityAutonomy,
} from '@/services/community'

const baseStatus: CommunityStatus = {
  enabled: true,
  logged_in: true,
  agent_id: 'agent-1',
  api_base: 'http://x/community',
  autonomy_mode: 'hitl',
  code_host: 'github',
  domains: [],
  pending_count: 2,
}

const approval: CommunityApproval = {
  id: 'a1',
  action: 'post_proposal',
  payload: { title: 'Title', body: 'Body' },
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
}

const initial = useCommunityStore.getState()

describe('communityStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommunityStore.setState(initial, true)
  })

  it('refresh loads status and pending approvals when logged in', async () => {
    vi.mocked(fetchCommunityStatus).mockResolvedValue(baseStatus)
    vi.mocked(fetchCommunityApprovals).mockResolvedValue([approval])

    await useCommunityStore.getState().refresh()

    const s = useCommunityStore.getState()
    expect(s.status?.agent_id).toBe('agent-1')
    expect(s.approvals).toHaveLength(1)
    expect(s.error).toBeNull()
    expect(fetchCommunityApprovals).toHaveBeenCalledWith('pending')
  })

  it('refresh records error and skips approvals when engine unreachable', async () => {
    vi.mocked(fetchCommunityStatus).mockResolvedValue(null)

    await useCommunityStore.getState().refresh()

    expect(useCommunityStore.getState().error).toBe('communityLoadError')
    expect(fetchCommunityApprovals).not.toHaveBeenCalled()
  })

  it('decide approve removes the item and decrements pending count', async () => {
    useCommunityStore.setState({ status: baseStatus, approvals: [approval] })
    vi.mocked(decideCommunityApproval).mockResolvedValue({ ok: true })

    await useCommunityStore.getState().decide('a1', 'approve')

    const s = useCommunityStore.getState()
    expect(s.approvals).toHaveLength(0)
    expect(s.status?.pending_count).toBe(1)
  })

  it('decide keeps the item and surfaces error on failure', async () => {
    useCommunityStore.setState({ status: baseStatus, approvals: [approval] })
    vi.mocked(decideCommunityApproval).mockResolvedValue({ ok: false, error: 'boom' })

    await useCommunityStore.getState().decide('a1', 'approve')

    const s = useCommunityStore.getState()
    expect(s.approvals).toHaveLength(1)
    expect(s.error).toBe('boom')
  })

  it('setAutonomy is optimistic and reconciles with the response', async () => {
    useCommunityStore.setState({ status: baseStatus })
    vi.mocked(setCommunityAutonomy).mockResolvedValue({ ...baseStatus, autonomy_mode: 'hybrid' })

    await useCommunityStore.getState().setAutonomy('hybrid')

    expect(useCommunityStore.getState().status?.autonomy_mode).toBe('hybrid')
  })

  it('setAutonomy rolls back on failure', async () => {
    useCommunityStore.setState({ status: baseStatus })
    vi.mocked(setCommunityAutonomy).mockRejectedValue(new Error('nope'))

    await useCommunityStore.getState().setAutonomy('fully_autonomous')

    const s = useCommunityStore.getState()
    expect(s.status?.autonomy_mode).toBe('hitl')
    expect(s.error).toBe('nope')
  })
})
