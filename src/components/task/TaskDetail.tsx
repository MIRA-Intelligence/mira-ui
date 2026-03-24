import { useProjectStore } from '@/stores/projectStore'
import { ExperimentDetail } from '../experiment/ExperimentDetail'
import { KnowledgePanel } from '../experiment/KnowledgePanel'

export function TaskDetail() {
  const { tasks, selectedTaskId, selectedExpId } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-sm">
        Select a project to get started
      </div>
    )
  }

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
            Ready to start
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
            Send a message to the agent to begin the first experiment.
            The agent will follow the scientific method: Question → Hypothesis → Experiment → Analysis.
          </p>
        </div>
      )
    }

    return (
      <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
        Select an experiment from the timeline
      </div>
    )
  }

  return <ExperimentDetail experiment={experiment} />
}
