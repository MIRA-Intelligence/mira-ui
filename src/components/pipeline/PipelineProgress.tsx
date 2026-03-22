import { useProjectStore } from '@/stores/projectStore'
import { cn } from '@/lib/utils'
import type { PipelineStage } from '@/types'

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'ideation', label: 'Ideation' },
  { key: 'planning', label: 'Planning' },
  { key: 'experiment', label: 'Experiment' },
  { key: 'writing', label: 'Writing' },
]

const stageIndex = (s: PipelineStage) => STAGES.findIndex((x) => x.key === s)

export function PipelineProgress() {
  const { pipelineStage } = useProjectStore()
  const activeIdx = stageIndex(pipelineStage)

  return (
    <div className="flex items-center justify-center gap-0 py-3 px-8 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {STAGES.map((stage, i) => {
        const isActive = i === activeIdx
        const isPast = i < activeIdx

        return (
          <div key={stage.key} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'w-24 h-px mx-1',
                  isPast ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'rounded-full border-2 transition-all',
                  isActive && 'w-4 h-4 border-[var(--color-accent)] bg-[var(--color-accent)]',
                  isPast && 'w-3 h-3 border-[var(--color-accent)] bg-[var(--color-accent)]',
                  !isActive && !isPast && 'w-3 h-3 border-[var(--color-border)] bg-transparent',
                )}
              />
              <span
                className={cn(
                  'text-xs',
                  isActive
                    ? 'text-[var(--color-text-primary)] font-semibold'
                    : 'text-[var(--color-text-muted)]',
                )}
              >
                {stage.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
