/* ── Experiment status ──────────────────────────── */

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed'

/* ── Experiment result ─────────────────────────── */

export interface ExperimentResult {
  metrics?: Record<string, number | string>
  findings?: string
  artifacts?: string[]
}

/* ── Training / execution progress ─────────────── */

export interface ExperimentProgress {
  epoch?: number
  total_epochs?: number
  current_metric?: string
  current_value?: number
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
    metrics?: Record<string, number | string>
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
    current_value?: number
  }
  parent?: string
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
