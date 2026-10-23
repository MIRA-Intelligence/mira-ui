import { describe, expect, it } from 'vitest'

import type { InboxItem } from '@/services/community'

import { canRenewClaim, itemSender, itemTitle } from './inboxDisplay'
import { shortTime } from './CommunityMailbox'

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: '1', kind: 'reply', type: 'reply', title: 'engine title', body: '', from: 'ada-agent', thread_id: 't',
  url: '', created_at: '2026-10-20T06:00:00Z', read: false, ...over,
})

describe('inbox display', () => {
  it('words proposal-claim news and offers renewal only for a reminder', () => {
    const claim = (state: string) => item({ kind: 'work', type: 'proposal_claim', state, from: '', thread_id: 'p1' })
    expect(itemTitle(claim('expiring'), 'zh')).toBe('你认领的提案即将到期')
    expect(itemTitle(claim('rejected'), 'en')).toBe('The community voted the proposal down; your claim ended')
    expect(canRenewClaim(claim('expiring'))).toBe(true)
    expect(canRenewClaim(claim('expired'))).toBe(false)
    expect(canRenewClaim({ ...claim('expiring'), thread_id: '' })).toBe(false)
  })

  it('words replies and mentions in the user language', () => {
    expect(itemTitle(item({ subject: 'Plugin crash isolation', on: 'post' }), 'zh')).toBe('ada-agent 回复了你的帖子《Plugin crash isolation》')
    expect(itemTitle(item({ subject: 'X', on: 'comment' }), 'en')).toBe('ada-agent replied to your comment on "X"')
    expect(itemTitle(item({ type: 'mention', kind: 'mention', subject: 'X' }), 'zh')).toBe('ada-agent 在《X》中提到了你')
  })

  it('words work and pull request updates, with the review verdict', () => {
    expect(itemTitle(item({ type: 'work_order_lease', kind: 'work', state: 'expired', from: '' }), 'zh')).toBe('你的工单租约已过期')
    expect(itemTitle(item({ type: 'pr_reviewed', kind: 'work', verdict: 'approve' }), 'en')).toBe('Your pull request was reviewed (approve)')
    expect(itemTitle(item({ type: 'pr_landed', kind: 'work' }), 'zh')).toBe('你的 PR 已落地')
  })

  it("keeps the engine's title when it cannot word one (older engines, unknown types)", () => {
    expect(itemTitle(item({}), 'zh')).toBe('engine title')
    expect(itemTitle(item({ type: 'badge_earned', kind: 'activity' }), 'zh')).toBe('engine title')
    expect(itemTitle(item({ type: 'work_order_lease', kind: 'work', state: 'weird' }), 'en')).toBe('engine title')
  })

  it('system events come from the community itself', () => {
    expect(itemSender(item({ from: '' }), 'zh')).toBe('Mira 社区')
    expect(itemSender(item({}), 'zh')).toBe('ada-agent')
  })

  it('shows the time for today and the date for earlier days', () => {
    const now = new Date('2026-10-20T15:00:00')
    expect(shortTime('2026-10-20T09:05:00', now)).toMatch(/9|09/)
    expect(shortTime('2026-10-18T09:05:00', now)).toMatch(/18/)
    expect(shortTime('not a date', now)).toBe('')
  })
})
