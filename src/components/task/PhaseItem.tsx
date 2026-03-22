import { cn } from '@/lib/utils'
import type { Phase } from '@/types'

interface PhaseItemProps {
  phase: Phase
}

export function PhaseItem({ phase }: PhaseItemProps) {
  return (
    <div className="flex items-start gap-2 py-1 pl-8">
      <span className="mt-0.5 shrink-0">
        {phase.status === 'completed' && (
          <span className="text-[var(--color-success)]">●</span>
        )}
        {phase.status === 'running' && (
          <span className="text-[var(--color-accent)]">○</span>
        )}
        {phase.status === 'pending' && (
          <span className="text-[var(--color-text-muted)]">○</span>
        )}
      </span>
      <span
        className={cn(
          'text-sm leading-snug',
          phase.status === 'completed'
            ? 'text-[var(--color-text-secondary)]'
            : phase.status === 'running'
              ? 'text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)]',
        )}
      >
        {phase.label}
      </span>
    </div>
  )
}
