export type PipelineStage = 'research' | 'planning' | 'experiment' | 'writing'

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
  stage?: PipelineStage
  phases?: Phase[]
  results?: StepResults
}

/* ── Research stage data ──────────────────────────── */

export interface PaperReference {
  id: string
  title: string
  authors: string
  year?: number | string
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  relevance?: string
  tags?: string[]
}

export interface ResearchData {
  papers?: PaperReference[]
  gaps?: string[]
  key_findings?: string[]
  summary?: string
}

/* ── Writing stage data ───────────────────────────── */

export interface DocumentSection {
  id: string
  title: string
  status: PhaseStatus
  word_count?: number
  preview?: string
}

export interface WritingData {
  outline?: DocumentSection[]
  total_words?: number
  target_words?: number
}

/* ── Stage-specific data container ────────────────── */

export interface StageData {
  research?: ResearchData
  writing?: WritingData
}

/* ── Project task ─────────────────────────────────── */

export interface ProjectTask {
  id: string
  label: string
  status: 'in_progress' | 'completed'
  pipelineStage: PipelineStage
  title: string
  steps: Step[]
  startedAt: string
  stageData?: StageData
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
 */
export interface TaskPlan {
  title: string
  pipeline_stage: PipelineStage
  status: 'in_progress' | 'completed' | 'failed'
  started_at: string
  steps: TaskPlanStep[]
  stage_data?: {
    research?: ResearchData
    writing?: WritingData
  }
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
  stage?: PipelineStage
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
  session_id?: string
  content: string
  media?: string[]
  metadata?: Record<string, unknown>
}
