import { useProjectStore } from '@/stores/projectStore'
import { ResearchView } from '../stages/ResearchView'
import { PlanningView } from '../stages/PlanningView'
import { ExperimentView } from '../stages/ExperimentView'
import { WritingView } from '../stages/WritingView'
import type { PipelineStage, Step } from '@/types'

const STAGE_ORDER: PipelineStage[] = ['research', 'planning', 'experiment', 'writing']

function stepsForStage(steps: Step[], stage: PipelineStage, activeStage: PipelineStage): Step[] {
  const tagged = steps.filter((s) => s.stage === stage)
  if (tagged.length > 0) return tagged

  const activeIdx = STAGE_ORDER.indexOf(activeStage)
  const stageIdx = STAGE_ORDER.indexOf(stage)
  if (stageIdx === activeIdx) return steps
  return []
}

export function TaskDetail() {
  const { tasks, selectedTaskId, pipelineStage, viewingStage } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        Select a project from the list
      </div>
    )
  }

  const displayStage = viewingStage ?? pipelineStage
  const stageSteps = stepsForStage(task.steps, displayStage, pipelineStage)

  switch (displayStage) {
    case 'research':
      return <ResearchView steps={stageSteps} data={task.stageData?.research} />
    case 'planning':
      return <PlanningView steps={stageSteps} />
    case 'experiment':
      return <ExperimentView steps={stageSteps} />
    case 'writing':
      return <WritingView steps={stageSteps} data={task.stageData?.writing} />
    default:
      return <PlanningView steps={stageSteps} />
  }
}
