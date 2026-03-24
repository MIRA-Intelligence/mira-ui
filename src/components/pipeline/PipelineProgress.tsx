import { useProjectStore } from '@/stores/projectStore'
import { cn } from '@/lib/utils'
import type { PipelineStage } from '@/types'

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'research', label: 'Research' },
  { key: 'planning', label: 'Planning' },
  { key: 'experiment', label: 'Experiment' },
  { key: 'writing', label: 'Writing' },
]

const stageIndex = (s: PipelineStage) => STAGES.findIndex((x) => x.key === s)

export function PipelineProgress() {
  const { pipelineStage, viewingStage, setViewingStage } = useProjectStore()
  const activeIdx = stageIndex(pipelineStage)
  const viewIdx = viewingStage ? stageIndex(viewingStage) : null

  const handleClick = (stage: PipelineStage, i: number) => {
    if (i > activeIdx) return
    setViewingStage(stage === (viewingStage ?? pipelineStage) ? null : stage)
  }

  return (
    <div className="flex items-center justify-center py-3 px-8 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {STAGES.map((stage, i) => {
        const isActive = i === activeIdx
        const isPast = i < activeIdx
        const clickable = i <= activeIdx
        const isViewing = viewIdx !== null ? i === viewIdx : isActive

        return (
          <div key={stage.key} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'w-20 h-0.5 rounded-full',
                  isPast || isActive
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-text-muted)]/25',
                )}
              />
            )}

            <button
              onClick={() => handleClick(stage.key, i)}
              disabled={!clickable}
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-1 rounded-lg transition-colors',
                clickable && 'hover:bg-[var(--color-bg-hover)] cursor-pointer',
                !clickable && 'cursor-default',
                isViewing && 'bg-[var(--color-accent)]/8',
              )}
            >
              <div
                className={cn(
                  'rounded-full transition-all',
                  isActive && 'w-4 h-4 bg-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30',
                  isPast && 'w-3 h-3 bg-[var(--color-accent)]',
                  !isActive && !isPast && 'w-3 h-3 bg-[var(--color-text-muted)]/30 border-2 border-[var(--color-text-muted)]/50',
                )}
              />
              <span
                className={cn(
                  'text-xs whitespace-nowrap transition-colors',
                  isViewing
                    ? 'text-[var(--color-accent)] font-semibold'
                    : isActive
                      ? 'text-[var(--color-text-primary)] font-semibold'
                      : isPast
                        ? 'text-[var(--color-text-secondary)]'
                        : 'text-[var(--color-text-muted)]',
                )}
              >
                {stage.label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
