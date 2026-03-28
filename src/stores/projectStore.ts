import { create } from 'zustand'
import type {
  ProjectTask, Experiment, ExperimentStatus, PipelineStage,
  NewProjectInput, Stats, TaskPlan, ResearchData, ResultData,
} from '@/types'
import { fetchPlan, fetchProjects, deleteProjectFiles } from '@/services/api'

interface ProjectState {
  tasks: ProjectTask[]
  selectedTaskId: string | null
  selectedExpId: string | null
  activeStage: PipelineStage
  mode: 'manual' | 'auto'
  stats: Stats
  startedAt: number
  projectsLoaded: boolean

  selectTask: (id: string) => void
  selectExperiment: (id: string | null) => void
  setActiveStage: (stage: PipelineStage) => void
  setMode: (mode: 'manual' | 'auto') => void
  refreshPlan: (projectId: string) => Promise<void>
  renameTask: (id: string, label: string) => void
  deleteTask: (id: string, deleteFiles?: boolean) => Promise<void>
  duplicateTask: (id: string) => void
  createProject: (input: NewProjectInput) => string
  loadProjects: () => Promise<void>
  nextProjectId: () => string
}

let dupCounter = 0
let projectCounter = 0

const PRJ_RE = /^PRJ-(\d+)$/

function syncCounterFromTasks(tasks: ProjectTask[]) {
  for (const t of tasks) {
    const m = PRJ_RE.exec(t.id)
    if (m) projectCounter = Math.max(projectCounter, parseInt(m[1], 10))
  }
}

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

function parseResearch(raw: any): ResearchData {
  if (!raw) return { references: [], notes: [] }
  const refs = Array.isArray(raw.references) ? raw.references.map((r: any) => ({
    id: r.id ?? '',
    title: r.title ?? '',
    authors: r.authors,
    year: r.year,
    venue: r.venue,
    url: r.url,
    summary: r.summary,
    relevance: r.relevance,
  })) : []
  const notes = Array.isArray(raw.notes) ? raw.notes : []
  return { references: refs, notes, survey: raw.survey }
}

function parseResult(raw: any): ResultData {
  if (!raw) return {}
  const sections = Array.isArray(raw.sections) ? raw.sections.map((s: any) => ({
    title: s.title ?? '', content: s.content ?? '',
  })) : undefined
  return {
    summary: raw.summary,
    outputPath: raw.output_path,
    outputType: raw.output_type,
    sections,
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
    research: parseResearch(raw.research),
    result: parseResult(raw.result),
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

function pickActiveExperimentId(task: ProjectTask | undefined, fallbackId: string | null = null): string | null {
  if (!task) return null

  const running = task.experiments.find((e) => e.status === 'running')?.id
  if (running) return running

  const current = task.experiments.find((e) => e.id === task.currentExperiment)
  if (current && current.status !== 'completed') return current.id

  const pending = task.experiments.find((e) => e.status === 'pending')?.id
  if (pending) return pending

  const experimentIds = new Set(task.experiments.map((e) => e.id))
  if (fallbackId && experimentIds.has(fallbackId)) return fallbackId

  return task.experiments[0]?.id ?? null
}

function resolveSelectedExperimentId(task: ProjectTask | undefined, selectedExpId: string | null): string | null {
  if (!task) return null
  if (selectedExpId === '__knowledge__') return '__knowledge__'

  const experimentIds = new Set(task.experiments.map((e) => e.id))
  if (selectedExpId && experimentIds.has(selectedExpId)) return selectedExpId

  return pickActiveExperimentId(task)
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  selectedExpId: null,
  activeStage: 'research',
  mode: 'auto',
  stats: { experiments: 0, completed: 0, failed: 0, running: 0 },
  startedAt: Date.now(),
  projectsLoaded: false,

  selectTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    const activeExp = pickActiveExperimentId(task)
    set({
      selectedTaskId: id,
      selectedExpId: activeExp,
      activeStage: 'research',
      startedAt: task?.startedAt
        ? new Date(task.startedAt).getTime()
        : get().startedAt,
    })
  },

  selectExperiment: (id) => set({ selectedExpId: id, activeStage: 'experiment' }),
  setActiveStage: (stage) => set({ activeStage: stage }),
  setMode: (mode) => set({ mode }),

  renameTask: (id, label) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, label } : t)),
    }))
  },

  deleteTask: async (id, deleteFiles = false) => {
    if (deleteFiles) {
      await deleteProjectFiles(id)
    }
    const { tasks, selectedTaskId } = get()
    const filtered = tasks.filter((t) => t.id !== id)
    set({
      tasks: filtered,
      stats: computeStats(filtered),
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

  nextProjectId: () => {
    syncCounterFromTasks(get().tasks)
    return `PRJ-${String(projectCounter + 1).padStart(4, '0')}`
  },

  createProject: (input) => {
    syncCounterFromTasks(get().tasks)
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
      research: { references: [], notes: [] },
      result: {},
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

  loadProjects: async () => {
    const remotes = await fetchProjects()

    const { tasks } = get()
    const existingIds = new Set(tasks.map((t) => t.id))
    const newTasks: ProjectTask[] = []

    const SKIP_DIRS = new Set(['skills', 'memory', 'sessions', 'media', 'cron', 'logs'])

    for (const r of remotes) {
      if (SKIP_DIRS.has(r.id)) continue
      const m = PRJ_RE.exec(r.id)
      if (m) projectCounter = Math.max(projectCounter, parseInt(m[1], 10))

      if (existingIds.has(r.id)) continue
      newTasks.push({
        id: r.id,
        label: r.title || r.id,
        status: r.status === 'completed' ? 'completed' : 'in_progress',
        title: r.title || r.id,
        coreQuestion: r.core_question,
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: r.started_at || new Date().toISOString(),
      })
    }

    // Also sync counter from existing in-memory tasks
    syncCounterFromTasks(tasks)

    const merged = newTasks.length > 0 ? [...tasks, ...newTasks] : tasks
    set({ tasks: merged, stats: computeStats(merged), projectsLoaded: true })

    for (const t of newTasks) {
      get().refreshPlan(t.id)
    }
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
        selectedExpId: resolveSelectedExperimentId(applied, get().selectedExpId),
        startedAt: applied.startedAt
          ? new Date(applied.startedAt).getTime()
          : get().startedAt,
      }),
    })
  },
}))
