import type { Experiment } from '@/types'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  completed: { label: 'Completed', cls: 'bg-[var(--color-success)]/15 text-[var(--color-success)]' },
  failed: { label: 'Failed', cls: 'bg-[var(--color-error)]/15 text-[var(--color-error)]' },
  running: { label: 'Running', cls: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' },
  pending: { label: 'Pending', cls: 'bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)]' },
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

function ProgressBar({ epoch, total, metric, value }: {
  epoch?: number; total?: number; metric?: string; value?: number | string
}) {
  if (!epoch || !total) return null
  const pct = Math.min((epoch / total) * 100, 100)
  const formattedValue = formatDecimal(value, 4)
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>Epoch {epoch} / {total}</span>
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
  const badge = STATUS_BADGE[experiment.status] ?? STATUS_BADGE.pending
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
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
            {experiment.commit && (
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                @ {experiment.commit.slice(0, 7)}
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{experiment.title}</h2>
        </div>

        {!hasScientificDetail && (
          <Section icon="○" label={experiment.status === 'pending' ? 'Planned' : 'Status'}>
            <p className="text-[var(--color-text-secondary)]">
              {experiment.status === 'pending'
                ? 'This experiment is planned from the research stage and has not started yet. Run it manually or continue in auto mode to execute it.'
                : 'Details will appear here as the agent fills in the experiment record.'}
            </p>
          </Section>
        )}

        {/* Scientific method sections */}
        {experiment.question && (
          <Section icon="?" label="Question">
            <p>{experiment.question}</p>
          </Section>
        )}

        {experiment.hypothesis && (
          <Section icon="!" label="Hypothesis">
            <p>{experiment.hypothesis}</p>
          </Section>
        )}

        {experiment.prediction && (
          <Section icon="→" label="Prediction">
            <p>{experiment.prediction}</p>
          </Section>
        )}

        {experiment.method && (
          <Section icon="⚙" label="Method">
            <p className="text-[var(--color-text-secondary)]">{experiment.method}</p>
          </Section>
        )}

        {/* Running progress */}
        {experiment.status === 'running' && experiment.progress && (
          <Section icon="▶" label="Progress">
            <ProgressBar
              epoch={experiment.progress.epoch}
              total={experiment.progress.total_epochs}
              metric={experiment.progress.current_metric}
              value={experiment.progress.current_value}
            />
          </Section>
        )}

        {/* Results */}
        {experiment.results && (
          <Section icon="📊" label="Results">
            {experiment.results.metrics && <MetricsTable metrics={experiment.results.metrics} />}
            {experiment.results.findings && (
              <p className="mt-2 text-[var(--color-text-secondary)]">{experiment.results.findings}</p>
            )}
            {experiment.results.artifacts && experiment.results.artifacts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {experiment.results.artifacts.map((a) => (
                  <span key={a} className="text-[10px] font-mono bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Conclusion */}
        {experiment.conclusion && (
          <Section icon="✓" label="Conclusion">
            <p>{experiment.conclusion}</p>
          </Section>
        )}

        {/* Next */}
        {experiment.next && (
          <Section icon="➡" label="Next">
            <p className="text-[var(--color-accent)]">{experiment.next}</p>
          </Section>
        )}
      </div>
    </div>
  )
}
