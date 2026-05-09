import { create } from 'zustand'
import type {
  ProjectTask, Experiment, ExperimentStatus, PipelineStage,
  NewProjectInput, Stats, TaskPlan, TaskPlanContract, ResearchData, ResultData, AppMode, AgentProfile, ContractVersion,
} from '@/types'
import {
  createRemoteProject,
  deleteProjectFiles,
  fetchPlan,
  fetchPlanContract,
  fetchProjects,
  updateProjectDisplayName,
  updateProjectRuntimePreferences,
} from '@/services/api'

async function clearAgentLogs(projectId: string): Promise<void> {
  try {
    const { useAgentStore } = await import('@/stores/agentStore')
    useAgentStore.getState().clearLogs(projectId)
  } catch {
    // Ignore optional log cleanup failures.
  }
}

interface ProjectState {
  tasks: ProjectTask[]
  appMode: AppMode
  selectedTaskId: string | null
  selectedExpId: string | null
  activeStage: PipelineStage
  agentProfile: AgentProfile
  contractVersion: ContractVersion
  mode: 'manual' | 'auto'
  stats: Stats
  projectsLoaded: boolean
  contractsByTask: Record<string, TaskPlanContract>

  setAppMode: (mode: AppMode) => void
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
  loadProjects: (options?: { replaceMissing?: boolean; refreshAll?: boolean }) => Promise<void>
  resetWorkspaceState: () => void
}

let dupCounter = 0

const EXPERIMENT_STATUS_SET: ReadonlySet<ExperimentStatus> = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])
const MODE_SET = new Set(['manual', 'auto'] as const)
const AGENT_PROFILE_SET = new Set(['engineer', 'research'] as const)
const CONTRACT_VERSION_SET = new Set([1, 2] as const)

function normalizeRunMode(value: unknown, fallback: 'manual' | 'auto' = 'auto'): 'manual' | 'auto' {
  return typeof value === 'string' && MODE_SET.has(value as 'manual' | 'auto')
    ? value as 'manual' | 'auto'
    : fallback
}

function normalizeAgentProfile(value: unknown, fallback: AgentProfile = 'research'): AgentProfile {
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

function isProjectFolderId(id: string): boolean {
  return id.trim().length > 0
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
    theoretical_proof: raw.theoretical_proof as string | undefined,
    isolation_test: raw.isolation_test ? safeClone(raw.isolation_test) : undefined,
    post_mortem: raw.post_mortem ? safeClone(raw.post_mortem) : undefined,
    evidence_refs: Array.isArray(raw.evidence_refs) ? safeClone(raw.evidence_refs) : undefined,
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
    theoretical_proof: raw.theoretical_proof as string | undefined,
    isolation_test: raw.isolation_test ? safeClone(raw.isolation_test) : undefined,
    post_mortem: raw.post_mortem ? safeClone(raw.post_mortem) : undefined,
    evidence_refs: Array.isArray(raw.evidence_refs) ? safeClone(raw.evidence_refs) : undefined,
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

function hasFinalResultOutput(result: ResultData): boolean {
  const hasOutputPath = typeof result.outputPath === 'string' && result.outputPath.trim().length > 0
  const hasOutputType = typeof result.outputType === 'string' && result.outputType.trim().length > 0
  const hasSummary = typeof result.summary === 'string' && result.summary.trim().length > 0
  const hasSections = Array.isArray(result.sections)
    && result.sections.some((section) => (
      (typeof section.title === 'string' && section.title.trim().length > 0)
      || (typeof section.content === 'string' && section.content.trim().length > 0)
    ))
  return hasOutputPath || hasOutputType || hasSummary || hasSections
}

function deriveTaskStatus(rawStatus: unknown, result: ResultData): ProjectTask['status'] {
  if (hasFinalResultOutput(result)) return 'completed'
  if (rawStatus === 'completed') return 'completed'
  return 'in_progress'
}

function applyPlanToTask(task: ProjectTask, raw: any): ProjectTask {
  const exps: any[] = Array.isArray(raw.experiments) ? raw.experiments : []
  const parsedExperiments = exps.map((e, i) => parseExperiment(e, i))
  const knowledge: string[] = Array.isArray(raw.knowledge) ? raw.knowledge : task.knowledge
  const parsedResult = parseResult(raw.result)

  return {
    ...task,
    status: deriveTaskStatus(raw.status, parsedResult),
    title: raw.title ?? task.title,
    coreQuestion: raw.core_question ?? task.coreQuestion,
    currentExperiment: raw.current_experiment ?? task.currentExperiment,
    startedAt: raw.started_at ?? task.startedAt,
    experiments: parsedExperiments,
    knowledge,
    research: parseResearch(raw.research),
    result: parsedResult,
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
  appMode: 'project',
  selectedTaskId: null,
  selectedExpId: null,
  activeStage: 'research',
  agentProfile: 'research',
  contractVersion: 1,
  mode: 'auto',
  stats: { experiments: 0, completed: 0, failed: 0, running: 0 },
  projectsLoaded: false,
  contractsByTask: {},

  setAppMode: (appMode) => {
    if (appMode === 'normal') {
      set({
        appMode,
        selectedTaskId: null,
        selectedExpId: null,
        activeStage: 'research',
      })
      return
    }
    set({ appMode })
  },

  selectTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    const activeExp = pickActiveExperimentId(task)
    set({
      appMode: 'project',
      selectedTaskId: id,
      selectedExpId: activeExp,
      activeStage: 'research',
      mode: normalizeRunMode(task?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(task?.agentProfile, get().agentProfile),
      contractVersion: normalizeContractVersion(task?.contractVersion, get().contractVersion),
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
      contractVersion,
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
    await clearAgentLogs(id)
    const { tasks, selectedTaskId } = get()
    const filtered = tasks.filter((t) => t.id !== id)
    const nextSelectedTaskId = selectedTaskId === id ? (filtered[0]?.id ?? null) : selectedTaskId
    const nextSelectedTask = filtered.find((t) => t.id === nextSelectedTaskId)
    set({
      tasks: filtered,
      appMode: nextSelectedTaskId ? 'project' : get().appMode,
      stats: computeStats(filtered),
      selectedTaskId: nextSelectedTaskId,
      selectedExpId: selectedTaskId === id ? null : get().selectedExpId,
      contractsByTask: Object.fromEntries(
        Object.entries(get().contractsByTask).filter(([taskId]) => taskId !== id),
      ),
      mode: normalizeRunMode(nextSelectedTask?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(nextSelectedTask?.agentProfile, get().agentProfile),
      contractVersion: normalizeContractVersion(nextSelectedTask?.contractVersion, get().contractVersion),
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

  resetWorkspaceState: () => {
    set({
      tasks: [],
      selectedTaskId: null,
      selectedExpId: null,
      activeStage: 'research',
      stats: { experiments: 0, completed: 0, failed: 0, running: 0 },
      projectsLoaded: false,
      contractsByTask: {},
    })
  },

  createProject: async (input) => {
    const current = get()
    const mode = normalizeRunMode(current.mode, 'auto')
    const agentProfile = normalizeAgentProfile(
      input.agentProfile ?? current.agentProfile,
      current.agentProfile,
    )
    const contractVersion = normalizeContractVersion(
      input.contractVersion ?? current.contractVersion,
      current.contractVersion,
    )
    const remote = await createRemoteProject({
      projectId: input.projectId,
      displayName: input.displayName ?? input.title,
      projectParentDir: input.projectParentDir,
      projectDir: input.projectDir,
      runMode: mode,
      agentProfile,
      contractVersion,
      automationPolicy: input.automationPolicy,
    })
    const id = remote.id
    if (!id) {
      throw new Error('Project creation response did not include an id')
    }
    const label = (remote.display_name && remote.display_name.trim())
      || input.displayName
      || input.title
      || id
    const task: ProjectTask = {
      id,
      label,
      projectDir: remote.project_dir,
      status: 'in_progress',
      title: input.description.slice(0, 120),
      coreQuestion: input.description,
      runMode: mode,
      agentProfile,
      contractVersion,
      experiments: [],
      knowledge: [],
      research: { references: [], notes: [] },
      result: {},
      startedAt: new Date().toISOString(),
    }
    await clearAgentLogs(id)
    set((state) => ({
      tasks: [task, ...state.tasks],
      appMode: 'project',
      selectedTaskId: id,
      selectedExpId: null,
      mode,
      agentProfile,
      contractVersion,
    }))
    return id
  },

  loadProjects: async (options) => {
    const remotes = await fetchProjects()
    if (!remotes) return

    const { appMode, tasks, selectedTaskId } = get()
    const remoteProjectIds = new Set(
      remotes
        .filter((remote) => isProjectFolderId(remote.id))
        .map((remote) => remote.id),
    )
    const keptTasks = tasks.filter((task) => (
      isProjectFolderId(task.id) && (!options?.replaceMissing || remoteProjectIds.has(task.id))
    ))
    const removedTaskIds = options?.replaceMissing
      ? tasks
          .filter((task) => isProjectFolderId(task.id) && !remoteProjectIds.has(task.id))
          .map((task) => task.id)
      : []
    const existingIds = new Set(keptTasks.map((t) => t.id))
    const newTasks: ProjectTask[] = []

    for (const r of remotes) {
      if (!isProjectFolderId(r.id)) continue
      if (existingIds.has(r.id)) continue
      newTasks.push({
        id: r.id,
        label: (r.display_name && r.display_name.trim()) || r.id,
        projectDir: r.project_dir,
        status: r.status === 'completed' ? 'completed' : 'in_progress',
        title: r.title || r.id,
        coreQuestion: r.core_question,
        runMode: normalizeRunMode(r.run_mode, 'auto'),
        agentProfile: normalizeAgentProfile(r.agent_profile, 'research'),
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
      const status: ProjectTask['status'] = remote.status === 'completed' ? 'completed' : 'in_progress'
      const runMode = normalizeRunMode(remote.run_mode, task.runMode ?? 'auto')
      const agentProfile = normalizeAgentProfile(remote.agent_profile, task.agentProfile ?? 'research')
      const contractVersion = normalizeContractVersion(remote.contract_version, task.contractVersion ?? 1)
      const title = remote.title || task.title
      const coreQuestion = remote.core_question ?? task.coreQuestion
      const startedAt = remote.started_at || task.startedAt
      const projectDir = remote.project_dir ?? task.projectDir
      if (
        task.label === displayName
        && task.status === status
        && task.title === title
        && task.coreQuestion === coreQuestion
        && task.startedAt === startedAt
        && task.projectDir === projectDir
        && task.runMode === runMode
        && task.agentProfile === agentProfile
        && task.contractVersion === contractVersion
      ) {
        return task
      }
      return {
        ...task,
        label: displayName,
        projectDir,
        status,
        title,
        coreQuestion,
        startedAt,
        runMode,
        agentProfile,
        contractVersion,
      }
    })

    const merged = newTasks.length > 0 ? [...refreshedTasks, ...newTasks] : refreshedTasks
    const mergedTaskIds = new Set(merged.map((task) => task.id))
    const nextContractsByTask = Object.fromEntries(
      Object.entries(get().contractsByTask).filter(([taskId]) => mergedTaskIds.has(taskId)),
    )
    const hasSelected = selectedTaskId ? merged.some((task) => task.id === selectedTaskId) : false
    const nextSelectedTaskId = appMode === 'normal'
      ? null
      : hasSelected ? selectedTaskId : (merged[0]?.id ?? null)
    const selectedTask = merged.find((task) => task.id === nextSelectedTaskId) ?? null
    set({
      tasks: merged,
      contractsByTask: nextContractsByTask,
      stats: computeStats(merged),
      projectsLoaded: true,
      appMode,
      selectedTaskId: nextSelectedTaskId,
      selectedExpId: hasSelected ? get().selectedExpId : null,
      mode: normalizeRunMode(selectedTask?.runMode, get().mode),
      agentProfile: normalizeAgentProfile(selectedTask?.agentProfile, get().agentProfile),
      contractVersion: normalizeContractVersion(selectedTask?.contractVersion, get().contractVersion),
    })

    const tasksToRefresh = options?.refreshAll ? merged : newTasks
    await Promise.all(tasksToRefresh.map(async (task) => {
      await get().refreshPlan(task.id)
    }))
    await Promise.all(removedTaskIds.map(async (projectId) => {
      await clearAgentLogs(projectId)
    }))
  },

  refreshPlan: async (projectId: string) => {
    const [plan, contract] = await Promise.all([
      fetchPlan(projectId) as Promise<TaskPlan | null>,
      fetchPlanContract(projectId),
    ])
    if (!plan && !contract) return

    const { tasks, selectedTaskId, contractsByTask } = get()
    const idx = tasks.findIndex((t) => t.id === projectId)
    const nextContracts = contract ? { ...contractsByTask, [projectId]: contract } : contractsByTask
    if (!plan) {
      if (contract) {
        set({ contractsByTask: nextContracts })
      }
      return
    }
    if (idx < 0) {
      if (contract) {
        set({ contractsByTask: nextContracts })
      }
      return
    }

    const updated = [...tasks]
    updated[idx] = applyPlanToTask(tasks[idx], plan)

    const isSelected = selectedTaskId === projectId
    const applied = updated[idx]
    set({
      tasks: updated,
      stats: computeStats(updated),
      contractsByTask: nextContracts,
      ...(isSelected && {
        selectedExpId: resolveSelectedExperimentId(applied, get().selectedExpId),
      }),
    })
  },
}))
