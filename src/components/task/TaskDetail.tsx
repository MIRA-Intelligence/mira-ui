import type { ReactNode } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '@/stores/settingsStore'
import { ExperimentDetail } from '../experiment/ExperimentDetail'
import { KnowledgePanel } from '../experiment/KnowledgePanel'
import { RevisionsPanel } from '../experiment/RevisionsPanel'
import { ResearchView } from '../stages/ResearchView'
import { ResultView } from '../stages/ResultView'
import { PlanView } from '../stages/PlanView'
import { t } from '@/i18n'
import { WorkflowWorkspace } from '@/components/workflow/WorkflowWorkspace'
import { ModuleStageControls } from '@/components/workflow/ModuleStageControls'

function ModulePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleStageControls />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

export function TaskDetail() {
  const { tasks, selectedTaskId, selectedExpId, activeStage } = useProjectStore(useShallow((s) => ({ tasks: s.tasks, selectedTaskId: s.selectedTaskId, selectedExpId: s.selectedExpId, activeStage: s.activeStage })))
  const lang = useSettingsStore((s) => s.language)
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm">
        {t('selectProjectToStart', lang)}
      </div>
    )
  }

  if (activeStage === 'modules') {
    return <WorkflowWorkspace />
  }

  if (activeStage === 'research') {
    return (
      <ModulePage>
        <ResearchView data={task.research} coreQuestion={task.coreQuestion} />
      </ModulePage>
    )
  }

  if (activeStage === 'plan') {
    return (
      <ModulePage>
        <PlanView task={task} />
      </ModulePage>
    )
  }

  if (activeStage === 'result') {
    return (
      <ModulePage>
        <ResultView data={task.result} task={task} />
      </ModulePage>
    )
  }

  // activeStage === 'experiment'
  if (selectedExpId === '__knowledge__') {
    return (
      <ModulePage>
        <KnowledgePanel knowledge={task.knowledge} coreQuestion={task.coreQuestion} />
      </ModulePage>
    )
  }

  if (selectedExpId === '__revisions__') {
    return (
      <ModulePage>
        <RevisionsPanel revisions={task.revisions ?? []} />
      </ModulePage>
    )
  }

  const experiment = task.experiments.find((e) => e.id === selectedExpId)

  if (!experiment) {
    if (task.experiments.length === 0) {
      return (
        <ModulePage>
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
        </ModulePage>
      )
    }

    return (
      <ModulePage>
        <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
          {t('selectExperimentFromTimeline', lang)}
        </div>
      </ModulePage>
    )
  }

  return (
    <ModulePage>
      <ExperimentDetail key={`${task.id}:${experiment.id}`} experiment={experiment} />
    </ModulePage>
  )
}
