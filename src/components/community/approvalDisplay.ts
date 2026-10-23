import type { CommunityApproval } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import type { useSettingsStore } from '@/stores/settingsStore'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

/**
 * Every action the engine can hold for approval (mira_engine/agent/tools/community.py
 * and community/persona.py). Unknown actions fall back to a generic label so a
 * newer engine never breaks the inbox.
 */
const ACTION_LABELS: Record<string, I18nKey> = {
  post_proposal: 'communityActionProposal',
  post: 'communityActionPost',
  comment: 'communityActionComment',
  vote: 'communityActionVote',
  accept_answer: 'communityActionAcceptAnswer',
  claim_work_order: 'communityActionClaimWorkOrder',
  renew_work_order: 'communityActionRenewWorkOrder',
  release_work_order: 'communityActionReleaseWorkOrder',
  review: 'communityActionReview',
  submit_patch: 'communityActionSubmitPatch',
  open_pr: 'communityActionOpenPr',
  persona_update: 'communityActionPersona',
}

export function actionLabel(action: string, lang: Lang): string {
  return t(ACTION_LABELS[action] ?? 'communityActionGeneric', lang)
}

const MAX_SUMMARY = 160

function clip(text: string): string {
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** One line telling the user what approving this action will do. */
export function approvalSummary(approval: CommunityApproval, lang: Lang): string {
  const p = approval.payload ?? {}
  const pick = (key: string): string => (typeof p[key] === 'string' ? (p[key] as string) : '')
  switch (approval.action) {
    case 'vote': {
      const value = Number(p.value ?? 1)
      const direction = t(value < 0 ? 'communityVoteDown' : 'communityVoteUp', lang)
      return `${direction} · ${shortId(pick('proposal_id'))}`
    }
    case 'review': {
      const verdict = pick('verdict')
      const body = pick('body')
      return clip(body ? `${verdict}: ${body}` : verdict)
    }
    case 'claim_work_order':
    case 'renew_work_order':
    case 'release_work_order': {
      const progress = pick('progress')
      const id = shortId(pick('work_order_id'))
      return clip(progress ? `${id} · ${progress}` : id)
    }
    case 'accept_answer':
      return shortId(pick('comment_id'))
    case 'submit_patch': {
      const repo = pick('repo')
      const title = pick('title')
      return clip(repo ? `${repo} · ${title}` : title)
    }
    case 'persona_update':
      // The diff itself is shown separately; it is the thing being approved.
      return t('communityPersonaHint', lang)
    default:
      return clip(pick('title') || pick('content') || pick('body'))
  }
}

/** The unified diff for a persona draft, so the user approves exactly what changes. */
export function personaDiff(approval: CommunityApproval): string | null {
  if (approval.action !== 'persona_update') return null
  const diff = approval.payload?.diff
  return typeof diff === 'string' && diff.trim() ? diff : null
}
