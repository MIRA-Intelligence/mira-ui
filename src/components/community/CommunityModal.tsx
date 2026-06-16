import { useEffect } from 'react'

import { useCommunityStore } from '@/stores/communityStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { AutonomyMode, CommunityApproval } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'

const AUTONOMY_MODES: { mode: AutonomyMode; label: I18nKey; hint: I18nKey }[] = [
  { mode: 'fully_autonomous', label: 'communityAutonomyFully', hint: 'communityAutonomyFullyHint' },
  { mode: 'hybrid', label: 'communityAutonomyHybrid', hint: 'communityAutonomyHybridHint' },
  { mode: 'hitl', label: 'communityAutonomyHitl', hint: 'communityAutonomyHitlHint' },
]

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

function actionLabel(action: string, lang: Lang): string {
  switch (action) {
    case 'post_proposal':
      return t('communityActionProposal', lang)
    case 'comment':
      return t('communityActionComment', lang)
    case 'vote':
      return t('communityActionVote', lang)
    default:
      return t('communityActionGeneric', lang)
  }
}

function approvalSummary(approval: CommunityApproval): string {
  const p = approval.payload ?? {}
  const pick = (key: string): string =>
    typeof p[key] === 'string' ? (p[key] as string) : ''
  const text = pick('title') || pick('content') || pick('body') || ''
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

export function CommunityModal() {
  const { communityOpen, closeCommunity } = useUiStore()
  const lang = useSettingsStore((s) => s.language)
  const {
    status,
    approvals,
    loading,
    error,
    pairing,
    decidingId,
    refresh,
    setAutonomy,
    decide,
    startPairing,
    cancelPairing,
  } = useCommunityStore()

  useEffect(() => {
    if (!communityOpen) return
    void refresh()
  }, [communityOpen, refresh])

  if (!communityOpen) return null

  const loggedIn = !!status?.logged_in
  const errorText = error === 'communityLoadError' ? t('communityLoadError', lang) : error

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={closeCommunity} />
      <div className="relative w-[640px] max-h-[88vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden">
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
          </div>
          <button
            onClick={closeCommunity}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {errorText && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {errorText}
            </div>
          )}

          {!loggedIn ? (
            <JoinSection
              lang={lang}
              loading={loading}
              pairing={pairing}
              onJoin={() => void startPairing()}
              onCancel={cancelPairing}
            />
          ) : (
            <>
              <section className="space-y-1">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('communitySubtitle', lang)}
                </p>
                {status?.agent_id && (
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {t('communityAgentLabel', lang)}: <span className="font-mono">{status.agent_id}</span>
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {t('communityAutonomy', lang)}
                </h3>
                <div className="grid gap-2">
                  {AUTONOMY_MODES.map(({ mode, label, hint }) => {
                    const active = status?.autonomy_mode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => void setAutonomy(mode)}
                        className={cn(
                          'text-left rounded-lg border px-3 py-2.5 transition-colors',
                          active
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                            : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'h-3.5 w-3.5 rounded-full border',
                              active
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                                : 'border-[var(--color-border)]',
                            )}
                          />
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">
                            {t(label, lang)}
                          </span>
                        </div>
                        <p className="mt-1 pl-5 text-[11px] text-[var(--color-text-muted)]">
                          {t(hint, lang)}
                        </p>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {t('communityRestartHint', lang)}
                </p>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    {t('communityApprovals', lang)}
                    {approvals.length > 0 && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                        {t('communityPendingCount', lang, { count: approvals.length })}
                      </span>
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={loading}
                    className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                  >
                    {t('communityRefresh', lang)}
                  </button>
                </div>

                {approvals.length === 0 ? (
                  <p className="rounded-lg border border-[var(--color-border)] px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                    {t('communityApprovalsEmpty', lang)}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {approvals.map((approval) => (
                      <li
                        key={approval.id}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                            {actionLabel(approval.action, lang)}
                          </span>
                        </div>
                        {approvalSummary(approval) && (
                          <p className="mt-1.5 text-sm text-[var(--color-text-primary)] break-words">
                            {approvalSummary(approval)}
                          </p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={decidingId === approval.id}
                            onClick={() => void decide(approval.id, 'approve')}
                            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {t('communityApprove', lang)}
                          </button>
                          <button
                            type="button"
                            disabled={decidingId === approval.id}
                            onClick={() => void decide(approval.id, 'reject')}
                            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                          >
                            {t('communityReject', lang)}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function JoinSection({
  lang,
  loading,
  pairing,
  onJoin,
  onCancel,
}: {
  lang: Lang
  loading: boolean
  pairing: ReturnType<typeof useCommunityStore.getState>['pairing']
  onJoin: () => void
  onCancel: () => void
}) {
  return (
    <section className="space-y-4 py-4 text-center">
      <div className="space-y-1">
        <p className="text-sm text-[var(--color-text-secondary)]">{t('communitySubtitle', lang)}</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">{t('communityJoinHint', lang)}</p>
      </div>

      {!pairing.active ? (
        <button
          type="button"
          onClick={onJoin}
          disabled={loading}
          className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {t('communityJoin', lang)}
        </button>
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
