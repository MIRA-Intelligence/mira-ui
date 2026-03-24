import { useProjectStore } from '@/stores/projectStore'

export function PipelineProgress() {
  const { tasks, selectedTaskId, stats } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="flex items-center justify-center py-2.5 px-8 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        <span className="text-xs text-[var(--color-text-muted)]">No project selected</span>
      </div>
    )
  }

  const total = task.experiments.length
  const completed = task.experiments.filter((e) => e.status === 'completed').length
  const failed = task.experiments.filter((e) => e.status === 'failed').length
  const running = task.experiments.filter((e) => e.status === 'running').length
  const current = task.experiments.find((e) => e.status === 'running')

  return (
    <div className="flex items-center gap-4 py-2.5 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* Project title */}
      <div className="min-w-0 flex-1">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {task.title || task.label}
        </h1>
        {task.coreQuestion && (
          <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">
            {task.coreQuestion}
          </p>
        )}
      </div>

      {/* Current experiment */}
      {current && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--color-accent)]/8">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span className="text-[11px] font-mono text-[var(--color-accent)]">
            {current.id}: {current.title}
          </span>
        </div>
      )}

      {/* Experiment counters */}
      {total > 0 && (
        <div className="shrink-0 flex items-center gap-2 text-[11px]">
          {completed > 0 && (
            <span className="text-[var(--color-success)]">✓ {completed}</span>
          )}
          {failed > 0 && (
            <span className="text-[var(--color-error)]">✗ {failed}</span>
          )}
          {running > 0 && (
            <span className="text-[var(--color-accent)]">● {running}</span>
          )}
          <span className="text-[var(--color-text-muted)]">/ {total}</span>
        </div>
      )}
    </div>
  )
}
