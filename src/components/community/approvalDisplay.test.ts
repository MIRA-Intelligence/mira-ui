import { describe, expect, it } from 'vitest'

import type { CommunityApproval } from '@/services/community'

import { actionLabel, approvalSummary, personaDiff } from './approvalDisplay'

function approval(action: string, payload: Record<string, unknown>): CommunityApproval {
  return { id: '1', action, payload, status: 'pending', created_at: '2026-10-20T00:00:00Z' }
}

describe('approval display', () => {
  it('labels every action the engine can hold for approval', () => {
    const actions = [
      'post_proposal', 'post', 'comment', 'vote', 'accept_answer', 'claim_work_order',
      'renew_work_order', 'release_work_order', 'review', 'submit_patch', 'open_pr', 'persona_update',
    ]
    for (const action of actions) {
      expect(actionLabel(action, 'en'), action).not.toBe('Action')
    }
    expect(actionLabel('something_new', 'en')).toBe('Action')
    expect(actionLabel('claim_work_order', 'zh')).toBe('领取工单')
  })

  it('summarises what approving will do', () => {
    expect(approvalSummary(approval('vote', { proposal_id: '3dee576d-3a7b', value: -1 }), 'en')).toBe('Downvote · 3dee576d')
    expect(approvalSummary(approval('review', { verdict: 'approve', body: 'looks fine' }), 'en')).toBe('approve: looks fine')
    expect(approvalSummary(approval('claim_work_order', { work_order_id: 'fb5c1242-b58a' }), 'en')).toBe('fb5c1242')
    expect(approvalSummary(approval('submit_patch', { repo: 'o/r', title: 'Fix it' }), 'en')).toBe('o/r · Fix it')
    expect(approvalSummary(approval('post', { title: 'Weekly digest idea' }), 'en')).toBe('Weekly digest idea')
    expect(approvalSummary(approval('comment', { content: 'x'.repeat(200) }), 'en')).toHaveLength(161)
  })

  it('exposes the persona diff so it is never approved blind', () => {
    const diff = '--- current\n+++ proposed\n+- **Domains**: plugins\n'
    const persona = approval('persona_update', { draft: 'x', diff, workspace: '/w' })
    expect(personaDiff(persona)).toBe(diff)
    expect(approvalSummary(persona, 'en')).toMatch(/Check the diff/)
    expect(personaDiff(approval('comment', { diff }))).toBeNull()
    expect(personaDiff(approval('persona_update', { diff: '  ' }))).toBeNull()
  })
})
