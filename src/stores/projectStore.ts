import { create } from 'zustand'
import type {
  ProjectTask, PipelineStage, Stats, TaskStatus, PhaseStatus,
  StepResults, StageData, NewProjectInput,
} from '@/types'
import { mockTasks, mockStats } from '@/stores/mockData'
import { fetchPlan } from '@/services/api'

interface ProjectState {
  tasks: ProjectTask[]
  selectedTaskId: string | null
  pipelineStage: PipelineStage
  viewingStage: PipelineStage | null
  mode: 'manual' | 'auto'
  stats: Stats
  startedAt: number

  selectTask: (id: string) => void
  setMode: (mode: 'manual' | 'auto') => void
  setPipelineStage: (stage: PipelineStage) => void
  setViewingStage: (stage: PipelineStage | null) => void
  refreshPlan: (projectId: string) => Promise<void>
  renameTask: (id: string, label: string) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string) => void
  createProject: (input: NewProjectInput) => string
}

let dupCounter = 0
let projectCounter = 0

const STAGE_NORMALIZE: Record<string, PipelineStage> = {
  ideation: 'research',
  research: 'research',
  planning: 'planning',
  experiment: 'experiment',
  writing: 'writing',
}

function normalizeStage(s: string | undefined | null): PipelineStage {
  if (!s) return 'research'
  return STAGE_NORMALIZE[s] ?? 'research'
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function applyPlanToTask(task: ProjectTask, raw: any): ProjectTask {
  const steps: any[] = Array.isArray(raw.steps) ? raw.steps : []

  const stageData: StageData = {}
  const sd = raw.stage_data
  if (sd) {
    if (sd.research) stageData.research = sd.research
    if (sd.writing) stageData.writing = sd.writing
  }

  return {
    ...task,
    status: raw.status === 'completed' ? 'completed' : 'in_progress',
    pipelineStage: normalizeStage(raw.pipeline_stage),
    title: raw.title ?? task.title,
    startedAt: raw.started_at ?? task.startedAt,
    stageData: Object.keys(stageData).length > 0 ? stageData : task.stageData,
    steps: steps.map((s: any, i: number) => ({
      id: `${task.id}-s${i}`,
      number: (s.number as number) ?? i + 1,
      title: (s.title as string) ?? `Step ${i + 1}`,
      status: (s.status as TaskStatus) ?? 'pending',
      stage: normalizeStage(s.stage),
      results: s.results as StepResults | undefined,
      phases: Array.isArray(s.phases)
        ? s.phases.map((p: any, j: number) => ({
            id: `${task.id}-s${i}-p${j}`,
            label: (p.label as string) ?? `Phase ${j + 1}`,
            status: (p.status as PhaseStatus) ?? 'pending',
            description: p.detail as string | undefined,
          }))
        : undefined,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const useProjectStore = create<ProjectState>((set, get) => ({
  tasks: mockTasks,
  selectedTaskId: null,
  pipelineStage: 'research',
  viewingStage: null,
  mode: 'auto',
  stats: mockStats,
  startedAt: Date.now(),

  selectTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    set({
      selectedTaskId: id,
      viewingStage: null,
      pipelineStage: task?.pipelineStage ?? get().pipelineStage,
      startedAt: task?.startedAt
        ? new Date(task.startedAt).getTime()
        : get().startedAt,
    })
  },
  setMode: (mode) => set({ mode }),
  setPipelineStage: (stage) => set({ pipelineStage: stage }),
  setViewingStage: (stage) => set({ viewingStage: stage }),

  renameTask: (id, label) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, label } : t)),
    }))
  },

  deleteTask: (id) => {
    const { tasks, selectedTaskId } = get()
    const filtered = tasks.filter((t) => t.id !== id)
    set({
      tasks: filtered,
      selectedTaskId: selectedTaskId === id ? (filtered[0]?.id ?? null) : selectedTaskId,
    })
  },

  duplicateTask: (id) => {
    const { tasks } = get()
    const source = tasks.find((t) => t.id === id)
    if (!source) return
    const newId = `${source.id}-dup${++dupCounter}`
    const copy: ProjectTask = {
      ...structuredClone(source),
      id: newId,
      label: `${source.label} (copy)`,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    }
    const idx = tasks.indexOf(source)
    const updated = [...tasks]
    updated.splice(idx + 1, 0, copy)
    set({ tasks: updated, selectedTaskId: newId })
  },

  createProject: (input) => {
    const id = `PRJ-${String(++projectCounter).padStart(4, '0')}`
    const label = input.title?.trim() || id
    const task: ProjectTask = {
      id,
      label,
      status: 'in_progress',
      pipelineStage: 'research',
      title: input.description.slice(0, 120),
      steps: [],
      startedAt: new Date().toISOString(),
    }
    set((state) => ({
      tasks: [task, ...state.tasks],
      selectedTaskId: id,
      pipelineStage: 'research',
      viewingStage: null,
      startedAt: Date.now(),
    }))
    return id
  },

  refreshPlan: async (projectId: string) => {
    const plan = await fetchPlan(projectId)
    if (!plan) return

    const { tasks, selectedTaskId } = get()
    const idx = tasks.findIndex((t) => t.id === projectId)
    if (idx < 0) return

    const updated = [...tasks]
    updated[idx] = applyPlanToTask(tasks[idx], plan)

    const isSelected = selectedTaskId === projectId
    const applied = updated[idx]
    set({
      tasks: updated,
      ...(isSelected && {
        pipelineStage: applied.pipelineStage,
        startedAt: applied.startedAt
          ? new Date(applied.startedAt).getTime()
          : get().startedAt,
      }),
    })
  },
}))
