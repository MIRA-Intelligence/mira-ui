import { useState } from 'react'
import type { Experiment } from '@/types'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProjectArtifactUrl } from '@/services/api'
import { t } from '@/i18n'

const STATUS_BADGE_CLASS: Record<string, string> = {
  completed: 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
  failed: 'bg-[var(--color-error)]/15 text-[var(--color-error)]',
  skipped: 'bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)]',
  running: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  pending: 'bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)]',
}

function Section({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1.5 flex items-center gap-1.5">
        <span>{icon}</span> {label}
      </h3>
      <div className="text-sm text-[var(--color-text-primary)] leading-relaxed">{children}</div>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatDecimal(value: unknown, digits: number): string | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num.toFixed(digits) : null
}

function formatMetricValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(4) : String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return '-'
  if (Array.isArray(value)) return value.join(', ')
  return JSON.stringify(value)
}

function isImageArtifact(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
}

function MetricsTable({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics)
  if (entries.length === 0) return null

  const allScalar = entries.every(([, val]) => !isRecord(val))
  if (!allScalar) {
    return (
      <div className="mt-2 space-y-3">
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="text-xs font-mono text-[var(--color-text-muted)] mb-2">{key}</div>
            {isRecord(val)
              ? <MetricsTable metrics={val} />
              : <div className="text-sm text-[var(--color-text-primary)]">{formatMetricValue(val)}</div>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto mt-2">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {entries.map(([key]) => (
              <th key={key} className="py-1 px-2 text-left text-[var(--color-text-muted)] font-medium">{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {entries.map(([key, val]) => (
              <td key={key} className="py-1 px-2 font-mono text-[var(--color-text-primary)]">
                {formatMetricValue(val)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ProgressBar({ epoch, total, metric, value, epochLabel }: {
  epoch?: number; total?: number; metric?: string; value?: number | string; epochLabel: string
}) {
  if (!epoch || !total) return null
  const pct = Math.min((epoch / total) * 100, 100)
  const formattedValue = formatDecimal(value, 4)
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>{epochLabel} {epoch} / {total}</span>
        {metric && formattedValue && <span>{metric} = {formattedValue}</span>}
      </div>
      <div className="h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function ExperimentDetail({ experiment }: { experiment: Experiment }) {
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const lang = useSettingsStore((s) => s.language)
  const [expandedImageArtifacts, setExpandedImageArtifacts] = useState<Record<string, boolean>>({})
  const badgeLabel = experiment.status === 'completed'
    ? t('completed', lang)
    : experiment.status === 'failed'
      ? t('failed', lang)
      : experiment.status === 'skipped'
        ? t('skipped', lang)
        : experiment.status === 'running'
          ? t('running', lang)
          : t('pending', lang)
  const badgeClass = STATUS_BADGE_CLASS[experiment.status] ?? STATUS_BADGE_CLASS.pending
  const hasScientificDetail = Boolean(
    experiment.question
    || experiment.hypothesis
    || experiment.prediction
    || experiment.method
    || experiment.results
    || experiment.conclusion
    || experiment.next
    || experiment.progress,
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">{experiment.id}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeClass}`}>{badgeLabel}</span>
            {experiment.commit && (
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                @ {experiment.commit.slice(0, 7)}
              </span>
            )}
          </div>
          <h2 className={[
            'text-lg font-semibold',
            experiment.status === 'failed' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]',
            experiment.status === 'skipped' ? 'line-through text-[var(--color-text-muted)]' : '',
          ].join(' ')}>
            {experiment.title}
          </h2>
        </div>

        {!hasScientificDetail && (
          <Section icon="○" label={experiment.status === 'pending' ? t('planned', lang) : t('progress', lang)}>
            <p className="text-[var(--color-text-secondary)]">
              {experiment.status === 'pending'
                ? t('experimentPendingHint', lang)
                : experiment.status === 'skipped'
                  ? t('experimentSkippedHint', lang)
                  : t('experimentDetailsPending', lang)}
            </p>
          </Section>
        )}

        {/* Scientific method sections */}
        {experiment.question && (
          <Section icon="?" label={t('question', lang)}>
            <p>{experiment.question}</p>
          </Section>
        )}

        {experiment.hypothesis && (
          <Section icon="!" label={t('hypothesis', lang)}>
            <p>{experiment.hypothesis}</p>
          </Section>
        )}

        {experiment.prediction && (
          <Section icon="→" label={t('prediction', lang)}>
            <p>{experiment.prediction}</p>
          </Section>
        )}

        {experiment.method && (
          <Section icon="⚙" label={t('method', lang)}>
            <p className="text-[var(--color-text-secondary)]">{experiment.method}</p>
          </Section>
        )}

        {/* Running progress */}
        {experiment.status === 'running' && experiment.progress && (
          <Section icon="▶" label={t('progress', lang)}>
            <ProgressBar
              epoch={experiment.progress.epoch}
              total={experiment.progress.total_epochs}
              metric={experiment.progress.current_metric}
              value={experiment.progress.current_value}
              epochLabel={t('epoch', lang)}
            />
          </Section>
        )}

        {/* Results */}
        {experiment.results && (
          <Section icon="📊" label={t('results', lang)}>
            {experiment.results.metrics && <MetricsTable metrics={experiment.results.metrics} />}
            {experiment.results.findings && (
              <p className="mt-2 text-[var(--color-text-secondary)]">{experiment.results.findings}</p>
            )}
            {experiment.results.artifacts && experiment.results.artifacts.length > 0 && (
              <div className="mt-2 space-y-2">
                {experiment.results.artifacts.map((a) => {
                  const canOpen = !!selectedTaskId
                  const isImage = isImageArtifact(a)
                  const expanded = !!expandedImageArtifacts[a]
                  const artifactUrl = selectedTaskId ? getProjectArtifactUrl(selectedTaskId, a) : ''
                  return (
                    <div key={a} className="space-y-1">
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => {
                          if (!selectedTaskId) return
                          if (isImage) {
                            setExpandedImageArtifacts((prev) => ({ ...prev, [a]: !prev[a] }))
                            return
                          }
                          window.open(artifactUrl, '_blank', 'noopener,noreferrer')
                        }}
                        className="text-[10px] font-mono bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
                        title={!canOpen ? t('selectProjectFirst', lang) : isImage ? t('progressMetricHint', lang) : t('openArtifact', lang)}
                      >
                        {isImage ? (expanded ? '▼ ' : '▷ ') : '↗ '}
                        {a}
                      </button>
                      {selectedTaskId && isImage && expanded && (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
                          <img
                            src={getProjectArtifactUrl(selectedTaskId, a)}
                            alt={a}
                            loading="lazy"
                            className="max-h-[360px] w-auto rounded-md border border-[var(--color-border)]"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {/* Conclusion */}
        {experiment.conclusion && (
          <Section icon="✓" label={t('conclusion', lang)}>
            <p>{experiment.conclusion}</p>
          </Section>
        )}

        {/* Next */}
        {experiment.next && (
          <Section icon="➡" label={t('next', lang)}>
            <p className="text-[var(--color-accent)]">{experiment.next}</p>
          </Section>
        )}
      </div>
    </div>
  )
}
