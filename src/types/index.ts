/* ── Pipeline stages ───────────────────────────── */

export type PipelineStage = 'research' | 'experiment' | 'result'

/* ── Experiment status ──────────────────────────── */

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed'

/* ── Experiment result ─────────────────────────── */

export interface ExperimentResult {
  metrics?: Record<string, unknown>
  findings?: string
  artifacts?: string[]
}

/* ── Training / execution progress ─────────────── */

export interface ExperimentProgress {
  epoch?: number
  total_epochs?: number
  current_metric?: string
  current_value?: number | string
}

/* ── Single experiment ─────────────────────────── */

export interface Experiment {
  id: string
  title: string
  status: ExperimentStatus
  question?: string
  hypothesis?: string
  prediction?: string
  method?: string
  results?: ExperimentResult
  conclusion?: string
  next?: string
  commit?: string
  progress?: ExperimentProgress
  parent?: string
}

/* ── Research data (literature & references) ───── */

export interface Reference {
  id: string
  title: string
  authors?: string
  year?: string
  venue?: string
  url?: string
  summary?: string
  relevance?: string
}

export interface ResearchData {
  references: Reference[]
  notes: string[]
  survey?: string
}

/* ── Final result / deliverable ────────────────── */

export interface ResultData {
  summary?: string
  outputPath?: string
  outputType?: string
  sections?: ResultSection[]
}

export interface ResultSection {
  title: string
  content: string
}

/* ── Project task (one project = many experiments) ── */

export interface ProjectTask {
  id: string
  label: string
  status: 'in_progress' | 'completed' | 'pending'
  title: string
  coreQuestion?: string
  currentExperiment?: string
  experiments: Experiment[]
  knowledge: string[]
  research: ResearchData
  result: ResultData
  startedAt: string
}

/* ── Agent log entry ───────────────────────────── */

export interface LogEntry {
  id: string
  timestamp: string
  content: string
  type: 'response' | 'progress' | 'tool_call' | 'error'
  metadata?: Record<string, unknown>
  collapsed?: boolean
}

/* ── Stats (status bar) ────────────────────────── */

export interface Stats {
  experiments: number
  completed: number
  failed: number
  running: number
}

/* ── task_plan.json — contract between agent & UI ── */

export interface TaskPlan {
  title: string
  core_question?: string
  status: 'in_progress' | 'completed' | 'failed'
  started_at?: string
  current_experiment?: string
  experiments: TaskPlanExperiment[]
  knowledge?: string[]
  research?: {
    references?: Array<{
      id: string; title: string; authors?: string; year?: string
      venue?: string; url?: string; summary?: string; relevance?: string
    }>
    notes?: string[]
    survey?: string
  }
  result?: {
    summary?: string
    output_path?: string
    output_type?: string
    sections?: Array<{ title: string; content: string }>
  }
}

export interface TaskPlanExperiment {
  id: string
  title: string
  status: string
  question?: string
  hypothesis?: string
  prediction?: string
  method?: string
  results?: {
    metrics?: Record<string, unknown>
    findings?: string
    artifacts?: string[]
  }
  conclusion?: string
  next?: string
  commit?: string
  progress?: {
    epoch?: number
    total_epochs?: number
    current_metric?: string
    current_value?: number | string
  }
  parent?: string
}

/* ── New Project creation ────────────────────────── */

export type OutputGoal = 'paper' | 'report' | 'analysis' | 'code'

export interface NewProjectInput {
  description: string
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
