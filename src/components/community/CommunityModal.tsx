import { useEffect, useState } from 'react'

import { useCommunityStore } from '@/stores/communityStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { agentLabel } from '@/services/community'
import type { PublicProfileInput } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'

import { CommunityMailbox } from './CommunityMailbox'
import { ProfileFields, buildPublicProfile, emptyProfileForm, profileFormProblem } from './ProfileForm'

export { buildPublicProfile }

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

export function CommunityModal() {
  const { communityOpen, closeCommunity } = useUiStore()
  const lang = useSettingsStore((s) => s.language)
  const { status, loading, error, pairing, onboarding, refresh, startPairing, cancelPairing, onboard } =
    useCommunityStore()

  useEffect(() => {
    if (!communityOpen) return
    void refresh()
  }, [communityOpen, refresh])

  if (!communityOpen) return null

  const loggedIn = !!status?.logged_in
  // Show the onboarding action unless the agent is confirmed active/suspended.
  // This also covers an unknown status (older engine that doesn't report it).
  const member = status?.member_status
  const needsOnboarding = loggedIn && member !== 'active' && member !== 'suspended'
  const errorText =
    error === 'communityLoadError'
      ? t('communityLoadError', lang)
      : error === 'onboardError'
        ? t('communityOnboardError', lang)
        : error

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={closeCommunity} />
      <div
        className={cn(
          'relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden',
          loggedIn ? 'w-[min(1040px,94vw)] h-[min(720px,86vh)]' : 'w-[640px] max-h-[88vh]',
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {t('communityTitle', lang)}
            </h2>
            {loggedIn && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t('communityConnected', lang)}
              </span>
            )}
            {loggedIn && <MemberBadge status={status?.member_status} lang={lang} />}
          </div>
          <div className="flex items-center gap-3">
            {loggedIn && status?.agent_id && (
              <span className="hidden text-[11px] text-[var(--color-text-muted)] md:inline" data-testid="community-agent-label">
                {t('communityAgentLabel', lang)}:{' '}
                {status.agent_name ? (
                  <>
                    <span className="text-[var(--color-text-secondary)]">{status.agent_name}</span>{' '}
                    <span className="font-mono">#{status.agent_id.slice(0, 8)}</span>
                  </>
                ) : (
                  <span className="font-mono">{agentLabel(null, status.agent_id)}</span>
                )}
              </span>
            )}
            {status?.web_url && (
              <a
                href={status.web_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              >
                {t('communityOpenWebsite', lang)} ↗
              </a>
            )}
            <button
              onClick={closeCommunity}
              aria-label={t('communityClose', lang)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className={cn('overflow-y-auto px-6 space-y-6', loggedIn ? 'shrink-0 py-0 empty:hidden' : 'flex-1 py-5')}>
          {errorText && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {errorText}
            </div>
          )}

          {!loggedIn ? (
            <JoinSection
              // Remount once the status arrives, so the defaults come from it.
              key={status ? 'ready' : 'loading'}
              lang={lang}
              loading={loading}
              pairing={pairing}
              initialName={status?.suggested_name ?? status?.agent_name ?? ''}
              initialDomains={status?.domains ?? []}
              onJoin={(profile) => void startPairing(profile)}
              onCancel={cancelPairing}
            />
          ) : (
            <>
              {needsOnboarding && (
                <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                    {t('communityOnboardTitle', lang)}
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-secondary)]">
                    {t('communityOnboardHint', lang)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onboard()}
                    disabled={onboarding}
                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {onboarding ? t('communityOnboarding', lang) : t('communityOnboardButton', lang)}
                  </button>
                </section>
              )}
            </>
          )}
        </div>
        {loggedIn && <CommunityMailbox lang={lang} />}
      </div>
    </div>
  )
}

function MemberBadge({
  status,
  lang,
}: {
  status?: 'pending' | 'active' | 'suspended' | null
  lang: Lang
}) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    pending: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    suspended: 'bg-red-500/15 text-red-300 ring-red-500/30',
    unknown: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] ring-[var(--color-border)]',
  }
  const key = status ?? 'unknown'
  const labelKey: I18nKey =
    key === 'active'
      ? 'communityMemberActive'
      : key === 'pending'
        ? 'communityMemberPending'
        : key === 'suspended'
          ? 'communityMemberSuspended'
          : 'communityMemberUnknown'
  const dot =
    key === 'active'
      ? 'bg-emerald-400'
      : key === 'pending'
        ? 'bg-amber-400'
        : key === 'suspended'
          ? 'bg-red-400'
          : 'bg-[var(--color-text-muted)]'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset',
        styles[key] ?? styles.unknown,
      )}
      title={t('communityMemberStatus', lang)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {t(labelKey, lang)}
    </span>
  )
}

function JoinSection({
  lang,
  loading,
  pairing,
  initialName,
  initialDomains,
  onJoin,
  onCancel,
}: {
  lang: Lang
  loading: boolean
  pairing: ReturnType<typeof useCommunityStore.getState>['pairing']
  initialName: string
  initialDomains: string[]
  onJoin: (profile: PublicProfileInput) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState(() => emptyProfileForm(initialName, initialDomains))
  const problem = profileFormProblem(form)
  const canJoin = !loading && !problem

  return (
    <section className="space-y-4 py-4">
      <div className="space-y-1 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">{t('communitySubtitle', lang)}</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityJoinHint', lang)}</p>
      </div>

      {!pairing.active ? (
        <form
          aria-label={t('communityProfileTitle', lang)}
          className="space-y-3 rounded-lg border border-[var(--color-border)] px-4 py-3 text-left"
          onSubmit={(e) => {
            e.preventDefault()
            if (canJoin) onJoin(buildPublicProfile(form))
          }}
        >
          <div className="space-y-0.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {t('communityProfileTitle', lang)}
            </h3>
            <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityProfileHint', lang)}</p>
          </div>
          <ProfileFields values={form} onChange={setForm} lang={lang} />
          {pairing.error && <p className="text-xs text-red-300">{pairing.error}</p>}
          <div className="text-center">
            <button
              type="submit"
              disabled={!canJoin}
              className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('communityJoin', lang)}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-primary)]">{t('communityJoining', lang)}</p>
          {pairing.userCode && (
            <div className="inline-block rounded-lg border border-[var(--color-border)] px-4 py-2 font-mono text-lg tracking-[0.2em] text-[var(--color-text-primary)]">
              {pairing.userCode}
            </div>
          )}
          {pairing.verificationUrl && (
            <p className="text-xs">
              <a
                href={pairing.verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-accent)] underline"
              >
                {pairing.verificationUrl}
              </a>
            </p>
          )}
          {pairing.error && <p className="text-xs text-red-300">{pairing.error}</p>}
          <div>
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
