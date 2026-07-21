import { useSettingsStore } from '@/stores/settingsStore'
import type { PlanRevision, PlanRevisionAction } from '@/types'
import { t } from '@/i18n'

const ACTION_ICON: Record<PlanRevisionAction, string> = {
  add: '＋',
  skip: '⤼',
  remove: '✕',
  reprioritize: '↕',
}

const ACTION_COLOR: Record<PlanRevisionAction, string> = {
  add: 'text-[var(--color-success)]',
  skip: 'text-[var(--color-text-muted)]',
  remove: 'text-[var(--color-error)]',
  reprioritize: 'text-[var(--color-accent)]',
}

function formatTimestamp(at: string | undefined): string | null {
  if (!at) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return date.toLocaleString()
}

export function RevisionsPanel({ revisions }: { revisions: PlanRevision[] }) {
  const lang = useSettingsStore((s) => s.language)
  // Newest first so the latest adaptive decision is at the top.
  const ordered = [...revisions].reverse()

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {t('planRevisions', lang)}
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          {t('planRevisionsSummary', lang)}
        </p>

        {ordered.length === 0 ? (
          <div className="text-sm text-[var(--color-text-muted)] text-center py-12">
            {t('noRevisionsYet', lang)}
          </div>
        ) : (
          <ol className="relative border-l border-[var(--color-border)] pl-5 space-y-4">
            {ordered.map((rev, i) => {
              const icon = ACTION_ICON[rev.action] ?? '•'
              const color = ACTION_COLOR[rev.action] ?? 'text-[var(--color-text-secondary)]'
              const ts = formatTimestamp(rev.at)
              return (
                <li key={`${rev.action}-${rev.target ?? i}-${rev.at ?? i}`} className="relative">
                  <span
                    className={`absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-bg-secondary)] text-[10px] font-mono ${color}`}
                  >
                    {icon}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
                      {t(`planRevisionAction_${rev.action}` as 'planRevisionAction_add', lang)}
                    </span>
                    {rev.target && (
                      <span className="font-mono text-[11px] text-[var(--color-text-primary)]">
                        {rev.target}
                      </span>
                    )}
                    {ts && (
                      <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{ts}</span>
                    )}
                  </div>
                  {rev.rationale && (
                    <p className="mt-1 text-sm text-[var(--color-text-primary)] leading-relaxed">
                      {rev.rationale}
                    </p>
                  )}
                  {rev.sourceExperiment && (
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      {t('planRevisionTriggeredBy', lang)}{' '}
                      <span className="font-mono">{rev.sourceExperiment}</span>
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
