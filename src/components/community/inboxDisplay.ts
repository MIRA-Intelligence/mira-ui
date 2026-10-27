import type { InboxItem } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import type { useSettingsStore } from '@/stores/settingsStore'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

const LEASE: Record<string, I18nKey> = {
  accepted: 'communityTitleLeaseAccepted',
  expired: 'communityTitleLeaseExpired',
  completed_by_other: 'communityTitleLeaseCompletedByOther',
  reopened: 'communityTitleLeaseReopened',
  released: 'communityTitleLeaseReleased',
}

const CLAIM: Record<string, I18nKey> = {
  expiring: 'communityTitleClaimExpiring',
  expired: 'communityTitleClaimExpired',
  pr_closed: 'communityTitleClaimPrClosed',
  rejected: 'communityTitleClaimRejected',
}

const PR: Record<string, I18nKey> = {
  pr_registered: 'communityTitlePrRegistered',
  pr_policy: 'communityTitlePrPolicy',
  pr_reviewed: 'communityTitlePrReviewed',
  pr_rejected: 'communityTitlePrRejected',
  pr_merged: 'communityTitlePrMerged',
  pr_landed: 'communityTitlePrLanded',
  pr_reverted: 'communityTitlePrReverted',
}

/**
 * The item's title in the user's language, built from its structured fields.
 * Anything unrecognised (or an older engine without those fields) keeps the
 * engine's own title.
 */
export function itemTitle(item: InboxItem, lang: Lang): string {
  const from = item.from || t('communityTitle', lang)
  const subject = item.subject ?? ''
  if (item.type === 'reply' && subject) {
    return t(item.on === 'comment' ? 'communityTitleReplyComment' : 'communityTitleReplyPost', lang, { from, subject })
  }
  if (item.type === 'mention' && subject) return t('communityTitleMention', lang, { from, subject })
  if (item.type === 'work_order_lease' && item.state && LEASE[item.state]) return t(LEASE[item.state], lang)
  if (item.type === 'work_order_cancelled') return t('communityTitleLeaseCancelled', lang)
  if (item.type === 'proposal_claim' && item.state && CLAIM[item.state]) return t(CLAIM[item.state], lang)
  if (PR[item.type]) {
    const base = t(PR[item.type], lang)
    return item.verdict ? `${base} (${item.verdict})` : base
  }
  return item.title
}

/** A proposal-claim reminder the user can renew from the inbox. */
export function canRenewClaim(item: InboxItem): boolean {
  return item.type === 'proposal_claim' && item.state === 'expiring' && Boolean(item.thread_id)
}

/** Who it is from; system events come from the community itself. */
export function itemSender(item: InboxItem, lang: Lang): string {
  return item.from || t('communityTitle', lang)
}
