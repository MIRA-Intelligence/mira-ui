import { useProjectStore } from '@/stores/projectStore'
import type { Experiment } from '@/types'

const STATUS_ICON: Record<string, string> = {
  completed: '✓',
  failed: '✗',
  skipped: '⤼',
  running: '●',
  pending: '○',
}
const STATUS_COLOR: Record<string, string> = {
  completed: 'text-[var(--color-success)]',
  failed: 'text-[var(--color-error)]',
  skipped: 'text-[var(--color-text-muted)]',
  running: 'text-[var(--color-accent)]',
  pending: 'text-[var(--color-text-muted)]',
}

function formatProgressValue(value: unknown): string | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num.toFixed(3) : null
}

function ExpItem({ exp, isSelected, onSelect }: {
  exp: Experiment
  isSelected: boolean
  onSelect: () => void
}) {
  const indent = exp.parent ? 'ml-4' : ''
  const progressValue = formatProgressValue(exp.progress?.current_value)
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors select-none flex items-start gap-1.5 ${indent} ${
        isSelected
          ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
          : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'
      }`}
    >
      <span className={`shrink-0 font-mono text-[11px] leading-4 ${STATUS_COLOR[exp.status] ?? STATUS_COLOR.pending}`}>
        {STATUS_ICON[exp.status] ?? STATUS_ICON.pending}
      </span>
      <span className="min-w-0">
        <span className="font-mono text-[10px] text-[var(--color-text-muted)] mr-1">{exp.id}</span>
        <span className={[
          exp.status === 'failed' ? 'text-[var(--color-error)]' : '',
          exp.status === 'skipped' ? 'line-through text-[var(--color-text-muted)]' : '',
        ].join(' ')}>
          {exp.title}
        </span>
        {exp.progress && exp.status === 'running' && (
          <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
            epoch {exp.progress.epoch}/{exp.progress.total_epochs}
            {progressValue && ` · ${exp.progress.current_metric}=${progressValue}`}
          </span>
        )}
      </span>
    </button>
  )
}

export function ExperimentTimeline() {
  const { tasks, selectedTaskId, selectedExpId, selectExperiment } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)] px-4 text-center">
        Select a project to see experiments
      </div>
    )
  }

  const experiments = task.experiments

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] uppercase tracking-wider">
          Experiments
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-1.5">
          {experiments.filter((e) => e.status === 'completed').length}/{experiments.length}
        </span>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {experiments.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] text-center py-8 px-3">
            No experiments yet. Send a message to start.
          </div>
        )}
        {experiments.map((exp) => (
          <ExpItem
            key={exp.id}
            exp={exp}
            isSelected={exp.id === selectedExpId}
            onSelect={() => selectExperiment(exp.id)}
          />
        ))}
      </div>

      {/* Knowledge count */}
      {task.knowledge.length > 0 && (
        <button
          onClick={() => selectExperiment('__knowledge__')}
          className={`mx-1.5 mb-1.5 px-2.5 py-1.5 rounded-md text-xs text-left transition-colors ${
            selectedExpId === '__knowledge__'
              ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
              : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'
          }`}
        >
          <span className="text-[11px]">💡 Knowledge</span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-1">({task.knowledge.length})</span>
        </button>
      )}
    </div>
  )
}
