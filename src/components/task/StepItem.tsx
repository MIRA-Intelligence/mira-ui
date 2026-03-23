import { useState } from 'react'
import { cn } from '@/lib/utils'
import { PhaseItem } from './PhaseItem'
import { ResultsCard } from './ResultsCard'
import type { Step } from '@/types'

interface StepItemProps {
  step: Step
}

export function StepItem({ step }: StepItemProps) {
  const hasPhases = step.phases && step.phases.length > 0
  const hasResults = !!step.results
  const expandable = hasPhases || hasResults
  const [expanded, setExpanded] = useState(step.status === 'running')

  return (
    <div className="py-1.5">
      <div
        className={cn(
          'flex items-start gap-3',
          expandable && 'cursor-pointer',
        )}
        onClick={() => expandable && setExpanded(!expanded)}
      >
        <span className="text-[var(--color-text-muted)] text-sm font-mono w-5 text-right shrink-0">
          {step.number}.
        </span>
        <span
          className={cn(
            'text-sm leading-snug flex-1',
            step.status === 'completed'
              ? 'text-[var(--color-text-secondary)]'
              : step.status === 'running'
                ? 'text-[var(--color-text-primary)]'
                : step.status === 'failed'
                  ? 'text-red-400'
                  : 'text-[var(--color-text-muted)]',
          )}
        >
          {step.title}
        </span>
        {step.status === 'completed' && (
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)] font-medium shrink-0">
            Completed
          </span>
        )}
        {step.status === 'running' && (
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium shrink-0">
            Running
          </span>
        )}
        {step.status === 'failed' && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-medium shrink-0">
            Failed
          </span>
        )}
        {expandable && (
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 mt-0.5">
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </div>

      {expandable && (
        <div
          className={cn(
            'ml-5 overflow-hidden transition-all duration-200 ease-in-out',
            expanded ? 'max-h-[1200px] opacity-100 mt-1' : 'max-h-0 opacity-0',
          )}
        >
          {/* Phases */}
          {hasPhases && step.phases!.map((phase) => (
            <PhaseItem key={phase.id} phase={phase} />
          ))}

          {/* Results card — shown for completed/failed steps */}
          {hasResults && <ResultsCard results={step.results!} />}
        </div>
      )}
    </div>
  )
}
