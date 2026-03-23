export type PipelineStage = 'ideation' | 'planning' | 'experiment' | 'writing'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export type PhaseStatus = 'pending' | 'running' | 'completed'

export interface Phase {
  id: string
  label: string
  status: PhaseStatus
  description?: string
}

export interface StepResults {
  metrics?: Record<string, number | string>
  findings?: string
  artifacts?: string[]
}

export interface Step {
  id: string
  number: number
  title: string
  status: TaskStatus
  phases?: Phase[]
  results?: StepResults
}

export interface ProjectTask {
  id: string
  label: string
  status: 'in_progress' | 'completed'
  pipelineStage: PipelineStage
  title: string
  steps: Step[]
  startedAt: string
}

export interface LogEntry {
  id: string
  timestamp: string
  content: string
  type: 'response' | 'progress' | 'tool_call' | 'error'
  metadata?: Record<string, unknown>
  collapsed?: boolean
}

export interface JobMonitorInfo {
  id: string
  label: string
  service?: string
}

export interface Stats {
  hypotheses: number
  papers: number
  tokens: number
  cost: number
  stages: { label: string; active: boolean }[]
}

/**
 * task_plan.json schema — the contract between agent and UI.
 *
 * The agent maintains this file in its workspace via write_file.
 * The UI fetches it via GET /api/plan?session=xxx after each response.
 */
export interface TaskPlan {
  title: string
  pipeline_stage: PipelineStage
  status: 'in_progress' | 'completed' | 'failed'
  started_at: string
  steps: TaskPlanStep[]
}

export interface TaskPlanResults {
  metrics?: Record<string, number | string>
  findings?: string
  artifacts?: string[]
}

export interface TaskPlanStep {
  number: number
  title: string
  status: TaskStatus
  phases?: TaskPlanPhase[]
  results?: TaskPlanResults
}

export interface TaskPlanPhase {
  label: string
  status: PhaseStatus
  detail?: string
}

/* ── New Project creation ────────────────────────── */

export type OutputGoal = 'paper' | 'report' | 'analysis' | 'code'

export interface NewProjectInput {
  description: string
  dataPath: string
  title?: string
  domain?: string
  references?: string
  computeBudget?: string
  outputGoal: OutputGoal
}

/* ── WebSocket protocol ─────────────────────────── */

export interface WsMessage {
  type: 'message' | 'command'
  content: string
  session_id: string
  user_id?: string
  media?: string[]
}

export interface WsResponse {
  type: 'response' | 'progress' | 'tool_call' | 'error'
  content: string
  media?: string[]
  metadata?: Record<string, unknown>
}
