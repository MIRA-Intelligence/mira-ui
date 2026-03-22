import { useProjectStore } from '@/stores/projectStore'
import { StepItem } from './StepItem'

export function TaskDetail() {
  const { tasks, selectedTaskId } = useProjectStore()
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        Select a task from the queue
      </div>
    )
  }

  if (task.steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        No steps defined for {task.label}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {task.steps.map((step) => (
        <StepItem key={step.id} step={step} />
      ))}
    </div>
  )
}
