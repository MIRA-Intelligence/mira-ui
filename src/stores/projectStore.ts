import { create } from 'zustand'
import type {
  ProjectTask, Experiment, ExperimentStatus, PipelineStage,
  NewProjectInput, Stats, TaskPlan, ResearchData, ResultData, AgentProfile, ContractVersion,
} from '@/types'
import {
  deleteProjectFiles,
  fetchPlan,
  fetchProjects,
  updateProjectDisplayName,
  updateProjectRuntimePreferences,
} from '@/services/api'

interface ProjectState {
  tasks: ProjectTask[]
  selectedTaskId: string | null
  selectedExpId: string | null
  activeStage: PipelineStage
  agentProfile: AgentProfile
  mode: 'manual' | 'auto'
  stats: Stats
  startedAt: number
  projectsLoaded: boolean

  selectTask: (id: string) => void
  selectExperiment: (id: string | null) => void
  setActiveStage: (stage: PipelineStage) => void
  setAgentProfile: (profile: AgentProfile) => void
  setMode: (mode: 'manual' | 'auto') => void
  setContractVersion: (version: ContractVersion) => void
  refreshPlan: (projectId: string) => Promise<void>
  renameTask: (id: string, label: string) => void
  deleteTask: (id: string, deleteFiles?: boolean) => Promise<void>
  duplicateTask: (id: string) => void
  createProject: (input: NewProjectInput) => Promise<string>
  loadProjects: () => Promise<void>
  nextProjectId: () => string
}

let dupCounter = 0

const PRJ_RE = /^PRJ-(\d+)$/
const PROJECT_FOLDER_PREFIX = 'PRJ'
const EXPERIMENT_STATUS_SET: ReadonlySet<ExperimentStatus> = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])
const MODE_SET = new Set(['manual', 'auto'] as const)
const AGENT_PROFILE_SET = new Set(['engineer', 'default', 'research'] as const)
const CONTRACT_VERSION_SET = new Set([1, 2] as const)

function normalizeRunMode(value: unknown, fallback: 'manual' | 'auto' = 'auto'): 'manual' | 'auto' {
  return typeof value === 'string' && MODE_SET.has(value as 'manual' | 'auto')
    ? value as 'manual' | 'auto'
    : fallback
}

function normalizeAgentProfile(value: unknown, fallback: AgentProfile = 'default'): AgentProfile {
  return typeof value === 'string' && AGENT_PROFILE_SET.has(value as AgentProfile)
    ? value as AgentProfile
    : fallback
}

function normalizeContractVersion(value: unknown, fallback: ContractVersion = 1): ContractVersion {
  return typeof value === 'number' && CONTRACT_VERSION_SET.has(value as ContractVersion)
    ? value as ContractVersion
    : fallback
}

function safeClone<T>(value: T): T {
  if (value == null) return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function normalizeExperimentStatus(value: unknown): ExperimentStatus {
  if (typeof value === 'string' && EXPERIMENT_STATUS_SET.has(value as ExperimentStatus)) {
    return value as ExperimentStatus
  }
  return 'pending'
}

function collectProjectNumbers(ids: Iterable<string>): Set<number> {
  const numbers = new Set<number>()
  for (const id of ids) {
    const match = PRJ_RE.exec(id)
    if (!match) continue
    numbers.add(parseInt(match[1], 10))
  }
  return numbers
}

function findFirstMissingProjectNumber(used: Set<number>): number {
  let n = 1
  while (used.has(n)) n += 1
  return n
}

function isProjectFolderId(id: string): boolean {
  return id.startsWith(PROJECT_FOLDER_PREFIX)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseExperimentSnapshot(raw: any): Experiment['snapshot'] {
  if (!raw || typeof raw !== 'object') return undefined
  return {
    title: raw.title as string | undefined,
    question: raw.question as string | undefined,
    hypothesis: raw.hypothesis as string | undefined,
    prediction: raw.prediction as string | undefined,
    method: raw.method as string | undefined,
    results: raw.results ? safeClone(raw.results) : undefined,
    conclusion: raw.conclusion as string | undefined,
    next: raw.next as string | undefined,
    commit: raw.commit as string | undefined,
    capturedAt: raw.captured_at as string | undefined,
    source: raw.source as string | undefined,
  }
}

function parseExperiment(raw: any, fallbackIdx: number): Experiment {
  return {
    id: (raw.id as string) ?? `Exp${String(fallbackIdx + 1).padStart(3, '0')}`,
    title: (raw.title as string) ?? 'Untitled experiment',
    status: normalizeExperimentStatus(raw.status),
    question: raw.question as string | undefined,
    hypothesis: raw.hypothesis as string | undefined,
    prediction: raw.prediction as string | undefined,
    method: raw.method as string | undefined,
    results: raw.results ? safeClone(raw.results) : undefined,
    conclusion: raw.conclusion as string | undefined,
    next: raw.next as string | undefined,
    commit: raw.commit as string | undefined,
    progress: raw.progress ? safeClone(raw.progress) : undefined,
    parent: raw.parent as string | undefined,
    snapshot: parseExperimentSnapshot(raw.snapshot),
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

function deriveTaskStatus(rawStatus: unknown, experiments: Experiment[]): ProjectTask['status'] {
  const hasActiveOrPending = experiments.some((e) => e.status === 'running' || e.status === 'pending')
  if (hasActiveOrPending) return 'in_progress'
  if (rawStatus === 'completed') return 'completed'
  return 'in_progress'
}

function applyPlanToTask(task: ProjectTask, raw: any): ProjectTask {
  const exps: any[] = Array.isArray(raw.experiments) ? raw.experiments : []
  const parsedExperiments = exps.map((e, i) => parseExperiment(e, i))
  const knowledge: string[] = Array.isArray(raw.knowledge) ? raw.knowledge : task.knowledge

  return {
    ...task,
    status: deriveTaskStatus(raw.status, parsedExperiments),
    title: raw.title ?? task.title,
    coreQuestion: raw.core_question ?? task.coreQuestion,
    currentExperiment: raw.current_experiment ?? task.currentExperiment,
    startedAt: raw.started_at ?? task.startedAt,
    experiments: parsedExperiments,
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
  if (current && current.status !== 'completed' && current.status !== 'skipped') return current.id

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
  agentProfile: 'default',
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
      mode: normalizeRunMode(task?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(task?.agentProfile, get().agentProfile),
      startedAt: task?.startedAt
        ? new Date(task.startedAt).getTime()
        : get().startedAt,
    })
  },

  selectExperiment: (id) => set({ selectedExpId: id, activeStage: 'experiment' }),
  setActiveStage: (stage) => set({ activeStage: stage }),
  setAgentProfile: (agentProfile) => {
    const selectedId = get().selectedTaskId
    set((state) => ({
      agentProfile,
      tasks: selectedId
        ? state.tasks.map((task) => (
            task.id === selectedId ? { ...task, agentProfile } : task
          ))
        : state.tasks,
    }))
    if (!selectedId) return
    void updateProjectRuntimePreferences(selectedId, { agentProfile })
  },
  setMode: (mode) => {
    const selectedId = get().selectedTaskId
    set((state) => ({
      mode,
      tasks: selectedId
        ? state.tasks.map((task) => (
            task.id === selectedId ? { ...task, runMode: mode } : task
          ))
        : state.tasks,
    }))
    if (!selectedId) return
    void updateProjectRuntimePreferences(selectedId, { runMode: mode })
  },
  setContractVersion: (contractVersion) => {
    const selectedId = get().selectedTaskId
    set((state) => ({
      tasks: selectedId
        ? state.tasks.map((task) => (
            task.id === selectedId ? { ...task, contractVersion } : task
          ))
        : state.tasks,
    }))
    if (!selectedId) return
    void updateProjectRuntimePreferences(selectedId, { contractVersion })
  },

  renameTask: (id, label) => {
    const nextLabel = label.trim()
    if (!nextLabel) return
    const previousLabel = get().tasks.find((task) => task.id === id)?.label ?? id

    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, label: nextLabel } : t)),
    }))

    void updateProjectDisplayName(id, nextLabel)
      .then((savedLabel) => {
        set((state) => ({
          tasks: state.tasks.map((task) => (
            task.id === id ? { ...task, label: savedLabel } : task
          )),
        }))
      })
      .catch(() => {
        set((state) => ({
          tasks: state.tasks.map((task) => (
            task.id === id ? { ...task, label: previousLabel } : task
          )),
        }))
      })
  },

  deleteTask: async (id, deleteFiles = false) => {
    if (deleteFiles) {
      await deleteProjectFiles(id)
    }
    const { tasks, selectedTaskId } = get()
    const filtered = tasks.filter((t) => t.id !== id)
    const nextSelectedTaskId = selectedTaskId === id ? (filtered[0]?.id ?? null) : selectedTaskId
    const nextSelectedTask = filtered.find((t) => t.id === nextSelectedTaskId)
    set({
      tasks: filtered,
      stats: computeStats(filtered),
      selectedTaskId: nextSelectedTaskId,
      selectedExpId: selectedTaskId === id ? null : get().selectedExpId,
      mode: normalizeRunMode(nextSelectedTask?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(nextSelectedTask?.agentProfile, get().agentProfile),
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
    const used = collectProjectNumbers(get().tasks.map((t) => t.id))
    return `PRJ-${String(findFirstMissingProjectNumber(used)).padStart(4, '0')}`
  },

  createProject: async (input) => {
    const { mode, agentProfile } = get()
    const remotes = await fetchProjects()
    const used = collectProjectNumbers([
      ...remotes.map((r) => r.id),
      ...get().tasks.map((t) => t.id),
    ])
    const id = `PRJ-${String(findFirstMissingProjectNumber(used)).padStart(4, '0')}`
    const task: ProjectTask = {
      id,
      label: id,
      status: 'in_progress',
      title: input.description.slice(0, 120),
      coreQuestion: input.description,
      runMode: mode,
      agentProfile,
      contractVersion: 1,
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

    const { tasks, selectedTaskId } = get()
    const keptTasks = tasks.filter((t) => isProjectFolderId(t.id))
    const existingIds = new Set(keptTasks.map((t) => t.id))
    const newTasks: ProjectTask[] = []

    for (const r of remotes) {
      if (!isProjectFolderId(r.id)) continue
      if (existingIds.has(r.id)) continue
      newTasks.push({
        id: r.id,
        label: (r.display_name && r.display_name.trim()) || r.id,
        status: r.status === 'completed' ? 'completed' : 'in_progress',
        title: r.title || r.id,
        coreQuestion: r.core_question,
        runMode: normalizeRunMode(r.run_mode, 'auto'),
        agentProfile: normalizeAgentProfile(r.agent_profile, 'default'),
        contractVersion: normalizeContractVersion(r.contract_version, 1),
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: r.started_at || new Date().toISOString(),
      })
    }

    const refreshedTasks = keptTasks.map((task) => {
      const remote = remotes.find((item) => item.id === task.id)
      if (!remote) return task
      const displayName = (remote.display_name && remote.display_name.trim()) || task.id
      const runMode = normalizeRunMode(remote.run_mode, task.runMode ?? 'auto')
      const agentProfile = normalizeAgentProfile(remote.agent_profile, task.agentProfile ?? 'default')
      const contractVersion = normalizeContractVersion(remote.contract_version, task.contractVersion ?? 1)
      if (
        task.label === displayName
        && task.runMode === runMode
        && task.agentProfile === agentProfile
        && task.contractVersion === contractVersion
      ) {
        return task
      }
      return { ...task, label: displayName, runMode, agentProfile, contractVersion }
    })

    const merged = newTasks.length > 0 ? [...refreshedTasks, ...newTasks] : refreshedTasks
    const hasSelected = selectedTaskId ? merged.some((task) => task.id === selectedTaskId) : false
    const nextSelectedTaskId = hasSelected ? selectedTaskId : (merged[0]?.id ?? null)
    const selectedTask = merged.find((task) => task.id === nextSelectedTaskId) ?? null
    set({
      tasks: merged,
      stats: computeStats(merged),
      projectsLoaded: true,
      selectedTaskId: nextSelectedTaskId,
      selectedExpId: hasSelected ? get().selectedExpId : null,
      mode: normalizeRunMode(selectedTask?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(selectedTask?.agentProfile, get().agentProfile),
    })

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
