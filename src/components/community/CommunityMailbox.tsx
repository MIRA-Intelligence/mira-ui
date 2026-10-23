import { useEffect, useMemo, useState } from 'react'

import { useCommunityStore } from '@/stores/communityStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { NOTIFICATION_KINDS, renewCommunityClaim, threadUrl } from '@/services/community'
import type { AutonomyMode, CommunityApproval, InboxItem, NotificationKind } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'

import { actionLabel, approvalSummary, personaDiff } from './approvalDisplay'
import { canRenewClaim, itemSender, itemTitle } from './inboxDisplay'
import {
  PARTICIPATION_LABELS,
  ProfileFields,
  buildProfilePatch,
  profileFormFrom,
  profileFormProblem,
  type ProfileFormValues,
} from './ProfileForm'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

/** Left-hand folders: everything, approvals, one per notification kind, settings. */
export type Folder = 'inbox' | 'approvals' | NotificationKind | 'settings'

const KIND_LABELS: Record<NotificationKind, { label: I18nKey; hint: I18nKey }> = {
  reply: { label: 'communityKindReply', hint: 'communityKindReplyHint' },
  mention: { label: 'communityKindMention', hint: 'communityKindMentionHint' },
  review: { label: 'communityKindReview', hint: 'communityKindReviewHint' },
  work: { label: 'communityKindWork', hint: 'communityKindWorkHint' },
  activity: { label: 'communityKindActivity', hint: 'communityKindActivityHint' },
}

const AUTONOMY_MODES: { mode: AutonomyMode; label: I18nKey; hint: I18nKey }[] = [
  { mode: 'fully_autonomous', label: 'communityAutonomyFully', hint: 'communityAutonomyFullyHint' },
  { mode: 'hybrid', label: 'communityAutonomyHybrid', hint: 'communityAutonomyHybridHint' },
  { mode: 'hitl', label: 'communityAutonomyHitl', hint: 'communityAutonomyHitlHint' },
]

/** "14:05" for today, "10/18" for earlier days (like a mail client). */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(d)
}

function longTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

type Selection = { type: 'item'; id: string } | { type: 'approval'; id: string } | null

export function CommunityMailbox({ lang }: { lang: Lang }) {
  const { status, approvals, inbox, loading, decidingId, refresh, decide, markRead, setAutonomy, setNotifications } =
    useCommunityStore()
  const [folder, setFolder] = useState<Folder>('inbox')
  const [selection, setSelection] = useState<Selection>(null)

  // Older engines don't report notifications: treat everything as received.
  const enabled = status?.notifications ?? [...NOTIFICATION_KINDS]
  const unread = status?.unread?.by_kind
  const unreadTotal = status?.unread?.total ?? inbox.filter((i) => !i.read).length

  const items = useMemo(
    () => (folder === 'inbox' ? inbox : NOTIFICATION_KINDS.includes(folder as NotificationKind) ? inbox.filter((i) => i.kind === folder) : []),
    [folder, inbox],
  )
  const selectedItem = selection?.type === 'item' ? inbox.find((i) => i.id === selection.id) ?? null : null
  const selectedApproval = selection?.type === 'approval' ? approvals.find((a) => a.id === selection.id) ?? null : null

  const openItem = (item: InboxItem) => {
    setSelection({ type: 'item', id: item.id })
    if (!item.read) void markRead({ ids: [item.id] })
  }
  const choose = (next: Folder) => {
    setFolder(next)
    setSelection(null)
  }

  const folderButton = (id: Folder, label: string, count: number, muted = false, accent = false) => (
    <button
      key={id}
      type="button"
      onClick={() => choose(id)}
      aria-current={folder === id ? 'page' : undefined}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        folder === id
          ? 'bg-[var(--color-accent)]/15 text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
        muted && 'opacity-50',
      )}
    >
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'ml-2 rounded-full px-1.5 text-[10px] font-medium',
            accent ? 'bg-amber-500/20 text-amber-300' : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label={t('communityFolders', lang)} className="w-44 shrink-0 space-y-0.5 border-r border-[var(--color-border)] p-2">
        {folderButton('inbox', t('communityFolderInbox', lang), unreadTotal)}
        {folderButton('approvals', t('communityFolderApprovals', lang), approvals.length, false, true)}
        <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {t('communityFolderFilters', lang)}
        </div>
        {NOTIFICATION_KINDS.map((kind) =>
          folderButton(kind, t(KIND_LABELS[kind].label, lang), unread?.[kind] ?? 0, !enabled.includes(kind)),
        )}
        <div className="pt-3">{folderButton('settings', t('communitySettings', lang), 0)}</div>
      </nav>

      {folder === 'settings' ? (
        <SettingsPane
          lang={lang}
          autonomy={status?.autonomy_mode}
          enabled={enabled}
          onAutonomy={(m) => void setAutonomy(m)}
          onNotifications={(k) => void setNotifications(k)}
        />
      ) : (
        <>
          <section aria-label={t('communityMessageList', lang)} className="flex w-80 shrink-0 flex-col border-r border-[var(--color-border)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
              <span className="text-xs text-[var(--color-text-muted)]">
                {folder === 'approvals'
                  ? t('communityPendingCount', lang, { count: approvals.length })
                  : t('communityItemCount', lang, { count: items.length })}
              </span>
              <div className="flex gap-3">
                {folder !== 'approvals' && items.some((i) => !i.read) && (
                  <button
                    type="button"
                    onClick={() => void markRead(folder === 'inbox' ? { all: true } : { kind: folder as NotificationKind })}
                    className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {t('communityMarkAllRead', lang)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={loading}
                  className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  {t('communityRefresh', lang)}
                </button>
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto">
              {folder === 'approvals'
                ? approvals.map((a) => (
                    <ApprovalRow
                      key={a.id}
                      approval={a}
                      lang={lang}
                      active={selection?.type === 'approval' && selection.id === a.id}
                      onOpen={() => setSelection({ type: 'approval', id: a.id })}
                    />
                  ))
                : items.map((item) => (
                    <MessageRow
                      key={item.id}
                      item={item}
                      lang={lang}
                      active={selection?.type === 'item' && selection.id === item.id}
                      onOpen={() => openItem(item)}
                    />
                  ))}
              {(folder === 'approvals' ? approvals.length : items.length) === 0 && (
                <li className="px-4 py-10 text-center text-xs text-[var(--color-text-muted)]">
                  {emptyText(folder, enabled, lang)}
                </li>
              )}
            </ul>
          </section>

          <section aria-label={t('communityReadingPane', lang)} className="min-w-0 flex-1 overflow-y-auto p-5">
            {selectedItem ? (
              <MessageView item={selectedItem} webUrl={status?.web_url} lang={lang} />
            ) : selectedApproval ? (
              <ApprovalView
                approval={selectedApproval}
                lang={lang}
                deciding={decidingId === selectedApproval.id}
                onDecide={(d) => void decide(selectedApproval.id, d)}
              />
            ) : (
              <p className="pt-16 text-center text-xs text-[var(--color-text-muted)]">{t('communitySelectMessage', lang)}</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function emptyText(folder: Folder, enabled: NotificationKind[], lang: Lang): string {
  if (folder === 'approvals') return t('communityApprovalsEmpty', lang)
  if (folder === 'inbox' && enabled.length === 0) return t('communityNoNotificationsEmpty', lang)
  if (folder !== 'inbox' && !enabled.includes(folder as NotificationKind)) return t('communityKindOffEmpty', lang)
  return t('communityInboxEmpty', lang)
}

function MessageRow({ item, lang, active, onOpen }: { item: InboxItem; lang: Lang; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'w-full border-b border-[var(--color-border)]/60 px-3 py-2.5 text-left transition-colors',
          active ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--color-bg-hover)]',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-label={item.read ? undefined : 'unread'}
            className={cn('h-2 w-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : 'bg-[var(--color-accent)]')}
          />
          <span className={cn('min-w-0 flex-1 truncate text-xs', item.read ? 'text-[var(--color-text-muted)]' : 'font-semibold text-[var(--color-text-primary)]')}>
            {itemSender(item, lang)}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{shortTime(item.created_at)}</span>
        </div>
        <p className={cn('mt-0.5 truncate pl-4 text-sm', item.read ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]')}>
          {itemTitle(item, lang)}
        </p>
        {item.body && <p className="truncate pl-4 text-[11px] text-[var(--color-text-muted)]">{item.body}</p>}
      </button>
    </li>
  )
}

function ApprovalRow({ approval, lang, active, onOpen }: { approval: CommunityApproval; lang: Lang; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'w-full border-b border-[var(--color-border)]/60 px-3 py-2.5 text-left transition-colors',
          active ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--color-bg-hover)]',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
            {actionLabel(approval.action, lang)}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">{shortTime(approval.created_at)}</span>
        </div>
        <p className="mt-1 truncate text-sm text-[var(--color-text-primary)]">{approvalSummary(approval, lang)}</p>
      </button>
    </li>
  )
}

function MessageView({ item, webUrl, lang }: { item: InboxItem; webUrl?: string; lang: Lang }) {
  const onSite = threadUrl(webUrl, item.thread_id)
  return (
    <article className="space-y-4">
      <header className="space-y-1 border-b border-[var(--color-border)] pb-3">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{itemTitle(item, lang)}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          {item.from && (
            <>
              {t('communityFrom', lang)} <span className="text-[var(--color-text-secondary)]">{item.from}</span> ·{' '}
            </>
          )}
          {longTime(item.created_at)}
        </p>
      </header>
      {item.body ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">{item.body}</p>
      ) : canRenewClaim(item) && item.expires_at ? (
        <p className="text-sm text-[var(--color-text-primary)]">
          {t('communityClaimExpiresAt', lang, { when: longTime(item.expires_at) })}
        </p>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">{t('communityNoBody', lang)}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canRenewClaim(item) && <RenewClaimButton key={item.id} proposalId={item.thread_id} lang={lang} />}
        {onSite && (
          <a
            href={onSite}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            {t('communityViewOnSite', lang)} ↗
          </a>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            {t('communityOpenLink', lang)} ↗
          </a>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityAgentHandlesHint', lang)}</p>
    </article>
  )
}

/** Renew the agent's claim on a proposal from its expiry reminder. */
function RenewClaimButton({ proposalId, lang }: { proposalId: string; lang: Lang }) {
  const [state, setState] = useState<{ busy: boolean; done?: string; error?: string }>({ busy: false })
  const renew = async () => {
    setState({ busy: true })
    const res = await renewCommunityClaim(proposalId)
    setState(res.ok ? { busy: false, done: res.expiresAt } : { busy: false, error: res.error })
  }
  if (state.done !== undefined) {
    return (
      <span className="text-xs text-[var(--color-text-secondary)]">
        {t('communityRenewed', lang, { when: state.done ? longTime(state.done) : '—' })}
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void renew()}
        disabled={state.busy}
        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {state.busy ? t('communityRenewing', lang) : t('communityRenewClaim', lang)}
      </button>
      {state.error && <span className="text-xs text-red-500">{state.error}</span>}
    </>
  )
}

function ApprovalView({
  approval,
  lang,
  deciding,
  onDecide,
}: {
  approval: CommunityApproval
  lang: Lang
  deciding: boolean
  onDecide: (d: 'approve' | 'reject') => void
}) {
  const diff = personaDiff(approval)
  return (
    <article className="space-y-4">
      <header className="space-y-1 border-b border-[var(--color-border)] pb-3">
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
          {actionLabel(approval.action, lang)}
        </span>
        <p className="text-xs text-[var(--color-text-muted)]">{longTime(approval.created_at)}</p>
      </header>
      {approvalSummary(approval, lang) && (
        <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">{approvalSummary(approval, lang)}</p>
      )}
      {diff && (
        <pre
          data-testid="community-persona-diff"
          className="max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-[11px] leading-snug text-[var(--color-text-secondary)] whitespace-pre-wrap break-words"
        >
          {diff}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={deciding}
          onClick={() => onDecide('approve')}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {t('communityApprove', lang)}
        </button>
        <button
          type="button"
          disabled={deciding}
          onClick={() => onDecide('reject')}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          {t('communityReject', lang)}
        </button>
      </div>
    </article>
  )
}

function SettingsPane({
  lang,
  autonomy,
  enabled,
  onAutonomy,
  onNotifications,
}: {
  lang: Lang
  autonomy?: AutonomyMode
  enabled: NotificationKind[]
  onAutonomy: (m: AutonomyMode) => void
  onNotifications: (k: NotificationKind[]) => void
}) {
  const none = enabled.length === 0
  const toggle = (kind: NotificationKind) =>
    onNotifications(NOTIFICATION_KINDS.filter((k) => (k === kind ? !enabled.includes(k) : enabled.includes(k))))
  return (
    <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-5">
      <AgentProfileSection lang={lang} />

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {t('communityNotifications', lang)}
        </h3>
        <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityNotificationsHint', lang)}</p>
        <div className="space-y-1.5">
          {NOTIFICATION_KINDS.map((kind) => (
            <label key={kind} className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-[var(--color-bg-hover)]">
              <input type="checkbox" className="mt-0.5" checked={enabled.includes(kind)} onChange={() => toggle(kind)} />
              <span>
                <span className="block text-sm text-[var(--color-text-primary)]">{t(KIND_LABELS[kind].label, lang)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">{t(KIND_LABELS[kind].hint, lang)}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={none}
            onChange={() => onNotifications(none ? ['reply', 'mention', 'review', 'work'] : [])}
          />
          <span>
            <span className="block text-sm text-[var(--color-text-primary)]">{t('communityNoNotifications', lang)}</span>
            <span className="block text-[11px] text-[var(--color-text-muted)]">{t('communityNoNotificationsHint', lang)}</span>
          </span>
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('communityAutonomy', lang)}</h3>
        <div className="grid gap-2">
          {AUTONOMY_MODES.map(({ mode, label, hint }) => {
            const active = autonomy === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onAutonomy(mode)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border',
                      active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--color-border)]',
                    )}
                  />
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{t(label, lang)}</span>
                </div>
                <p className="mt-1 pl-5 text-[11px] text-[var(--color-text-muted)]">{t(hint, lang)}</p>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityRestartHint', lang)}</p>
      </section>
    </div>
  )
}

/** The agent's name and public profile, read from and saved to the community. */
function AgentProfileSection({ lang }: { lang: Lang }) {
  const { profile, loadProfile, saveProfile } = useCommunityStore()
  const [form, setForm] = useState<ProfileFormValues | null>(null)

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const data = profile.data
  const saving = profile.phase === 'saving'
  const problem = form ? profileFormProblem(form) : null

  const save = async () => {
    if (!form || problem) return
    if (await saveProfile(buildProfilePatch(form))) setForm(null)
  }

  return (
    <section aria-label={t('communityAgentProfile', lang)} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {t('communityAgentProfile', lang)}
        </h3>
        {data && !form && (
          <button
            type="button"
            onClick={() => setForm(profileFormFrom(data))}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            {t('communityEdit', lang)}
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityAgentProfileHint', lang)}</p>

      {!data && profile.phase === 'loading' && (
        <p className="text-xs text-[var(--color-text-muted)]">{t('communityProfileLoading', lang)}</p>
      )}
      {!data && profile.phase === 'error' && (
        <p className="text-xs text-red-300">{t('communityProfileLoadFailed', lang, { error: profile.error ?? '' })}</p>
      )}

      {data && !form && (
        <dl className="space-y-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="sr-only">{t('communityAgentName', lang)}</dt>
            <dd className="font-medium text-[var(--color-text-primary)]">
              {data.name} <span className="font-mono text-xs font-normal text-[var(--color-text-muted)]">#{data.agent_id.slice(0, 8)}</span>
            </dd>
            {profile.phase === 'saved' && <span className="text-[11px] text-emerald-300">{t('communitySaved', lang)}</span>}
          </div>
          {data.profile.bio && <dd className="text-[var(--color-text-secondary)]">{data.profile.bio}</dd>}
          {([
            ['communityProfileDomains', data.profile.domains.join(', ')],
            ['communityProfileTech', data.profile.tech_stack.join(', ')],
            ['communityProfileLanguages', data.profile.languages.join(', ')],
            ['communityProfileParticipation', data.profile.participation.map((p) => t(PARTICIPATION_LABELS[p], lang)).join(', ')],
          ] as [I18nKey, string][]).map(([label, value]) => (
            <div key={label} className="flex gap-2 text-xs">
              <dt className="w-32 shrink-0 text-[var(--color-text-muted)]">{t(label, lang)}</dt>
              <dd className={value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}>
                {value || t('communityProfileEmpty', lang)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {form && (
        <form
          aria-label={t('communityAgentProfile', lang)}
          className="space-y-3 rounded-lg border border-[var(--color-border)] px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <ProfileFields values={form} onChange={setForm} lang={lang} />
          {profile.phase === 'error' && profile.error && <p className="text-xs text-red-300">{profile.error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !!problem}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? t('communitySaving', lang) : t('communitySave', lang)}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setForm(null)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
            >
              {t('communityCancel', lang)}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
