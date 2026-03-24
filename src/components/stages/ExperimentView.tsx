import type { Step } from '@/types'
import { StepItem } from '../task/StepItem'

interface ExperimentViewProps {
  steps: Step[]
}

export function ExperimentView({ steps }: ExperimentViewProps) {
  const completed = steps.filter((s) => s.status === 'completed').length
  const running = steps.find((s) => s.status === 'running')

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
          <path d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m14 0h2M3 15h2m14 0h2" />
          <rect x="7" y="7" width="10" height="10" rx="1" />
        </svg>
        <span className="text-xs">Experiments not started yet</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Progress summary bar */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-4">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Experiments
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[var(--color-success)]">{completed} completed</span>
          {running && (
            <span className="text-[var(--color-accent)]">
              Running: {running.title}
            </span>
          )}
          <span className="text-[var(--color-text-muted)]">
            {completed}/{steps.length} total
          </span>
        </div>
        {/* Mini progress bar */}
        <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden max-w-[200px]">
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
            style={{ width: `${steps.length > 0 ? (completed / steps.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Step list with results */}
      <div className="p-4">
        {steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
      </div>
    </div>
  )
}
