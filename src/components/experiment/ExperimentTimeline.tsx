import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Experiment } from '@/types'
import { t } from '@/i18n'

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

function ExpItem({ exp, isSelected, onSelect, lang }: {
  exp: Experiment
  isSelected: boolean
  onSelect: () => void
  lang: ReturnType<typeof useSettingsStore.getState>['language']
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
        {exp.guard_warnings && exp.guard_warnings.length > 0 && (
          <span
            role="img"
            aria-label="guard-warning"
            title={`${t('experimentGuardWarnings', lang)}\n${exp.guard_warnings.join('\n')}`}
            className="ml-1 font-bold text-[var(--color-error)] cursor-help"
          >
            !
          </span>
        )}
        {exp.progress && exp.status === 'running' && (
          <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
            {t('epoch', lang)} {exp.progress.epoch}/{exp.progress.total_epochs}
            {progressValue && ` · ${exp.progress.current_metric}=${progressValue}`}
          </span>
        )}
      </span>
    </button>
  )
}

export function ExperimentTimeline() {
  const { tasks, selectedTaskId, selectedExpId, selectExperiment } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)] px-4 text-center">
        {t('selectProjectToSeeExperiments', lang)}
      </div>
    )
  }

  const experiments = task.experiments

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] uppercase tracking-wider">
          {t('experiments', lang)}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-1.5">
          {experiments.filter((e) => e.status === 'completed').length}/{experiments.length}
        </span>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {experiments.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] text-center py-8 px-3">
            {t('noExperimentsYet', lang)}
          </div>
        )}
        {experiments.map((exp) => (
          <ExpItem
            key={exp.id}
            exp={exp}
            isSelected={exp.id === selectedExpId}
            lang={lang}
            onSelect={() => selectExperiment(exp.id)}
          />
        ))}
      </div>

      {/* Plan revisions (ReAct adaptive replanning audit) */}
      {(task.revisions?.length ?? 0) > 0 && (
        <button
          onClick={() => selectExperiment('__revisions__')}
          className={`mx-1.5 mb-1.5 px-2.5 py-1.5 rounded-md text-xs text-left transition-colors ${
            selectedExpId === '__revisions__'
              ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
              : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'
          }`}
        >
          <span className="text-[11px]">🔀 {t('planRevisions', lang)}</span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-1">({task.revisions?.length ?? 0})</span>
        </button>
      )}

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
          <span className="text-[11px]">💡 {t('knowledge', lang)}</span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-1">({task.knowledge.length})</span>
        </button>
      )}
    </div>
  )
}
