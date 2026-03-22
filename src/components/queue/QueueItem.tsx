import { cn } from '@/lib/utils'
import type { ProjectTask } from '@/types'

interface QueueItemProps {
  task: ProjectTask
  isSelected: boolean
  onSelect: (id: string) => void
}

export function QueueItem({ task, isSelected, onSelect }: QueueItemProps) {
  return (
    <button
      onClick={() => onSelect(task.id)}
      className={cn(
        'w-full px-3 py-2.5 text-left rounded-md text-sm font-mono transition-colors',
        isSelected
          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-accent)]/40'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
      )}
    >
      {task.label}
    </button>
  )
}
