import { create } from 'zustand'
import type { ProjectTask, PipelineStage, Stats, TaskPlan } from '@/types'
import { mockTasks, mockStats } from '@/stores/mockData'
import { fetchPlan } from '@/services/api'

interface ProjectState {
  tasks: ProjectTask[]
  selectedTaskId: string | null
  pipelineStage: PipelineStage
  mode: 'manual' | 'auto'
  stats: Stats
  startedAt: number
  livePlan: TaskPlan | null

  selectTask: (id: string) => void
  setMode: (mode: 'manual' | 'auto') => void
  setPipelineStage: (stage: PipelineStage) => void
  refreshPlan: () => Promise<void>
}

function planToTask(plan: TaskPlan): ProjectTask {
  return {
    id: '_live',
    label: 'LIVE',
    status: plan.status === 'completed' ? 'completed' : 'in_progress',
    pipelineStage: plan.pipeline_stage,
    title: plan.title,
    startedAt: plan.started_at,
    steps: plan.steps.map((s, i) => ({
      id: `live-s${i}`,
      number: s.number,
      title: s.title,
      status: s.status,
      phases: s.phases?.map((p, j) => ({
        id: `live-s${i}-p${j}`,
        label: p.label,
        status: p.status,
        description: p.detail,
      })),
    })),
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  tasks: mockTasks,
  selectedTaskId: mockTasks[2]?.id ?? null,
  pipelineStage: 'experiment',
  mode: 'auto',
  stats: mockStats,
  startedAt: Date.now() - 35 * 3600_000 - 44 * 60_000 - 7_000,
  livePlan: null,

  selectTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    set({
      selectedTaskId: id,
      pipelineStage: task?.pipelineStage ?? get().pipelineStage,
      startedAt: task?.startedAt
        ? new Date(task.startedAt).getTime()
        : get().startedAt,
    })
  },
  setMode: (mode) => set({ mode }),
  setPipelineStage: (stage) => set({ pipelineStage: stage }),

  refreshPlan: async () => {
    const plan = await fetchPlan()
    if (!plan) return

    const liveTask = planToTask(plan)
    const { tasks } = get()

    const existingIdx = tasks.findIndex((t) => t.id === '_live')
    let updated: ProjectTask[]
    if (existingIdx >= 0) {
      updated = [...tasks]
      updated[existingIdx] = liveTask
    } else {
      updated = [liveTask, ...tasks]
    }

    set({
      livePlan: plan,
      tasks: updated,
      selectedTaskId: '_live',
      pipelineStage: plan.pipeline_stage,
      startedAt: new Date(plan.started_at).getTime(),
    })
  },
}))
