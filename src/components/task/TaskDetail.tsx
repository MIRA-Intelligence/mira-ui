import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ExperimentDetail } from '../experiment/ExperimentDetail'
import { KnowledgePanel } from '../experiment/KnowledgePanel'
import { ResearchView } from '../stages/ResearchView'
import { ResultView } from '../stages/ResultView'
import { t } from '@/i18n'

export function TaskDetail() {
  const { tasks, selectedTaskId, selectedExpId, activeStage } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm">
        {t('selectProjectToStart', lang)}
      </div>
    )
  }

  if (activeStage === 'research') {
    return <ResearchView data={task.research} coreQuestion={task.coreQuestion} />
  }

  if (activeStage === 'result') {
    return <ResultView data={task.result} task={task} />
  }

  // activeStage === 'experiment'
  if (selectedExpId === '__knowledge__') {
    return <KnowledgePanel knowledge={task.knowledge} coreQuestion={task.coreQuestion} />
  }

  const experiment = task.experiments.find((e) => e.id === selectedExpId)

  if (!experiment) {
    if (task.experiments.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-8">
          <div className="text-2xl mb-3">🔬</div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
            {t('readyToStart', lang)}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
            {t('sendMessageToStartExperiment', lang)}
            {' '}
            {t('scientificMethodHint', lang)}
          </p>
        </div>
      )
    }

    return (
      <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
        {t('selectExperimentFromTimeline', lang)}
      </div>
    )
  }

  return <ExperimentDetail key={`${task.id}:${experiment.id}`} experiment={experiment} />
}
