import { useProjectStore } from '@/stores/projectStore'
import { useTimer } from '@/hooks/useTimer'

export function TopBar() {
  const { tasks, selectedTaskId, startedAt } = useProjectStore()
  const { formatted } = useTimer(startedAt)

  const selected = tasks.find((t) => t.id === selectedTaskId)
  const title = selected?.title ?? 'MedPilot'

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <div className="min-w-[140px]" />

      <h1 className="text-lg font-semibold text-[var(--color-text-primary)] text-center flex-1 truncate">
        {title}
      </h1>

      <div className="font-mono text-xl tracking-wider text-[var(--color-text-secondary)] tabular-nums min-w-[140px] text-right">
        T+ {formatted}
      </div>
    </header>
  )
}
