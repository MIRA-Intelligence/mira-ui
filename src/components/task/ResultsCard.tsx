import type { StepResults } from '@/types'

interface ResultsCardProps {
  results: StepResults
}

function formatMetricValue(v: number | string): string {
  if (typeof v === 'string') return v
  if (Number.isInteger(v)) return v.toLocaleString()
  if (Math.abs(v) < 0.01 || Math.abs(v) >= 1e6) return v.toExponential(2)
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function ResultsCard({ results }: ResultsCardProps) {
  const { metrics, findings, artifacts } = results
  const hasMetrics = metrics && Object.keys(metrics).length > 0
  const hasFindings = findings && findings.trim().length > 0
  const hasArtifacts = artifacts && artifacts.length > 0

  if (!hasMetrics && !hasFindings && !hasArtifacts) return null

  return (
    <div className="mt-2 ml-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/50 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-[10px] font-semibold tracking-wider text-[var(--color-text-muted)] uppercase">
          Results
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {/* Metrics grid */}
        {hasMetrics && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {Object.entries(metrics).map(([key, val]) => (
              <div key={key} className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-[var(--color-text-muted)]">{key}</span>
                <span className="text-sm font-mono font-medium text-[var(--color-text-primary)]">
                  {formatMetricValue(val)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Findings */}
        {hasFindings && (
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">
            {findings}
          </p>
        )}

        {/* Artifacts */}
        {hasArtifacts && (
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map((path) => {
              const filename = path.split('/').pop() || path
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-muted)]"
                  title={path}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {filename}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
