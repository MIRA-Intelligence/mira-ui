import { useProjectStore } from '@/stores/projectStore'
import type { PipelineStage } from '@/types'

const STAGES: { key: PipelineStage; label: string; icon: string }[] = [
  { key: 'research', label: 'Research', icon: '📚' },
  { key: 'experiment', label: 'Experiment', icon: '🔬' },
  { key: 'result', label: 'Result', icon: '📝' },
]

function stageBadge(task: ReturnType<typeof useProjectStore.getState>['tasks'][0], stage: PipelineStage): string | null {
  if (stage === 'research') {
    const count = task.research.references.length
    return count > 0 ? `${count}` : null
  }
  if (stage === 'experiment') {
    const c = task.experiments.filter((e) => e.status === 'completed').length
    const t = task.experiments.length
    return t > 0 ? `${c}/${t}` : null
  }
  if (stage === 'result') {
    const has = task.result?.summary || (task.result?.sections?.length ?? 0) > 0
    return has ? '✓' : null
  }
  return null
}

export function PipelineProgress() {
  const { tasks, selectedTaskId, activeStage, setActiveStage } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="flex items-center justify-center py-2.5 px-8 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        <span className="text-xs text-[var(--color-text-muted)]">No project selected</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-2 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* Project title */}
      <div className="min-w-0 shrink-0 max-w-[200px]">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {task.title || task.label}
        </h1>
      </div>

      <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />

      {/* Stage tabs */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        {STAGES.map((stage, idx) => {
          const isActive = activeStage === stage.key
          const badge = stageBadge(task, stage.key)

          return (
            <div key={stage.key} className="flex items-center">
              {idx > 0 && (
                <div className="w-6 h-px bg-[var(--color-border)] mx-0.5" />
              )}
              <button
                onClick={() => setActiveStage(stage.key)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all select-none ${
                  isActive
                    ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <span className="text-[13px]">{stage.icon}</span>
                <span>{stage.label}</span>
                {badge && (
                  <span className={`text-[10px] font-mono px-1 py-px rounded ${
                    isActive
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Core question (if short) */}
      {task.coreQuestion && (
        <p className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[300px] shrink-0">
          {task.coreQuestion}
        </p>
      )}
    </div>
  )
}
