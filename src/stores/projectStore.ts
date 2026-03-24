import { create } from 'zustand'
import type {
  ProjectTask, Experiment, ExperimentStatus,
  NewProjectInput, Stats, TaskPlan,
} from '@/types'
import { fetchPlan } from '@/services/api'

interface ProjectState {
  tasks: ProjectTask[]
  selectedTaskId: string | null
  selectedExpId: string | null
  mode: 'manual' | 'auto'
  stats: Stats
  startedAt: number

  selectTask: (id: string) => void
  selectExperiment: (id: string | null) => void
  setMode: (mode: 'manual' | 'auto') => void
  refreshPlan: (projectId: string) => Promise<void>
  renameTask: (id: string, label: string) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string) => void
  createProject: (input: NewProjectInput) => string
}

let dupCounter = 0
let projectCounter = 0

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseExperiment(raw: any, fallbackIdx: number): Experiment {
  return {
    id: (raw.id as string) ?? `Exp${String(fallbackIdx + 1).padStart(3, '0')}`,
    title: (raw.title as string) ?? 'Untitled experiment',
    status: (raw.status as ExperimentStatus) ?? 'pending',
    question: raw.question as string | undefined,
    hypothesis: raw.hypothesis as string | undefined,
    prediction: raw.prediction as string | undefined,
    method: raw.method as string | undefined,
    results: raw.results ?? undefined,
    conclusion: raw.conclusion as string | undefined,
    next: raw.next as string | undefined,
    commit: raw.commit as string | undefined,
    progress: raw.progress ?? undefined,
    parent: raw.parent as string | undefined,
  }
}

function applyPlanToTask(task: ProjectTask, raw: any): ProjectTask {
  const exps: any[] = Array.isArray(raw.experiments) ? raw.experiments : []
  const knowledge: string[] = Array.isArray(raw.knowledge) ? raw.knowledge : task.knowledge

  return {
    ...task,
    status: raw.status === 'completed' ? 'completed' : 'in_progress',
    title: raw.title ?? task.title,
    coreQuestion: raw.core_question ?? task.coreQuestion,
    currentExperiment: raw.current_experiment ?? task.currentExperiment,
    startedAt: raw.started_at ?? task.startedAt,
    experiments: exps.map((e, i) => parseExperiment(e, i)),
    knowledge,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function computeStats(tasks: ProjectTask[]): Stats {
  let experiments = 0, completed = 0, failed = 0, running = 0
  for (const t of tasks) {
    for (const e of t.experiments) {
      experiments++
      if (e.status === 'completed') completed++
      else if (e.status === 'failed') failed++
      else if (e.status === 'running') running++
    }
  }
  return { experiments, completed, failed, running }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  selectedExpId: null,
  mode: 'auto',
  stats: { experiments: 0, completed: 0, failed: 0, running: 0 },
  startedAt: Date.now(),

  selectTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    const activeExp = task?.currentExperiment ?? task?.experiments.find((e) => e.status === 'running')?.id ?? null
    set({
      selectedTaskId: id,
      selectedExpId: activeExp,
      startedAt: task?.startedAt
        ? new Date(task.startedAt).getTime()
        : get().startedAt,
    })
  },

  selectExperiment: (id) => set({ selectedExpId: id }),
  setMode: (mode) => set({ mode }),

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
      selectedExpId: selectedTaskId === id ? null : get().selectedExpId,
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
      title: input.description.slice(0, 120),
      coreQuestion: input.description,
      experiments: [],
      knowledge: [],
      startedAt: new Date().toISOString(),
    }
    set((state) => ({
      tasks: [task, ...state.tasks],
      selectedTaskId: id,
      selectedExpId: null,
      startedAt: Date.now(),
    }))
    return id
  },

  refreshPlan: async (projectId: string) => {
    const plan = await fetchPlan(projectId) as TaskPlan | null
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
      stats: computeStats(updated),
      ...(isSelected && {
        selectedExpId: applied.currentExperiment ?? get().selectedExpId,
        startedAt: applied.startedAt
          ? new Date(applied.startedAt).getTime()
          : get().startedAt,
      }),
    })
  },
}))
