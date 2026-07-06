/* ── Pipeline stages ───────────────────────────── */

export type PipelineStage = 'research' | 'plan' | 'experiment' | 'result'
export type AppMode = 'normal' | 'project'
export type AgentProfile = 'engineer' | 'research'
export type ContractVersion = 1 | 2

/* ── Experiment status ──────────────────────────── */

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

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

export interface ExperimentIsolationTest {
  control?: string
  treatment?: string
  isolated_variable?: string
  result?: string
}

export interface ExperimentPostMortem {
  residual_analysis?: string
  implementation_fidelity?: string
  five_whys?: string[]
}

export interface ExperimentEvidenceRef {
  ref_id?: string
  relevance?: string
  metric_key?: string
  artifact?: string
  [key: string]: unknown
}

export interface ExperimentSnapshot {
  title?: string
  question?: string
  hypothesis?: string
  prediction?: string
  method?: string
  results?: ExperimentResult
  conclusion?: string
  next?: string
  commit?: string
  theoretical_proof?: string
  isolation_test?: ExperimentIsolationTest
  post_mortem?: ExperimentPostMortem
  evidence_refs?: Array<ExperimentEvidenceRef | string>
  capturedAt?: string
  source?: string
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
  theoretical_proof?: string
  isolation_test?: ExperimentIsolationTest
  post_mortem?: ExperimentPostMortem
  evidence_refs?: Array<ExperimentEvidenceRef | string>
  progress?: ExperimentProgress
  parent?: string
  snapshot?: ExperimentSnapshot
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

/* ── Interactive plan mode ─────────────────────── */

export type PlanPhase = 'questions' | 'draft' | 'approved'
export type PlanQuestionKind = 'single' | 'multi' | 'text'

export interface PlanQuestion {
  id: string
  prompt: string
  kind: PlanQuestionKind
  options?: string[]
  rationale?: string
}

export interface PlanDraftExperiment {
  title: string
  hypothesis?: string
  method?: string
}

export interface PlanDraft {
  summary?: string
  experiments: PlanDraftExperiment[]
}

export interface PlanData {
  phase: PlanPhase
  questions: PlanQuestion[]
  answers: Record<string, string | string[]>
  draft?: PlanDraft
  feedback?: string
  updatedAt?: string
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
  projectDir?: string
  status: 'in_progress' | 'completed' | 'pending'
  title: string
  coreQuestion?: string
  runMode?: 'manual' | 'auto'
  agentProfile?: AgentProfile
  contractVersion?: ContractVersion
  currentExperiment?: string
  experiments: Experiment[]
  knowledge: string[]
  research: ResearchData
  plan?: PlanData
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
  plan?: {
    phase?: PlanPhase
    updated_at?: string
    questions?: Array<{
      id: string; prompt: string; kind: PlanQuestionKind
      options?: string[]; rationale?: string
    }>
    answers?: Record<string, string | string[]>
    draft?: {
      summary?: string
      experiments?: Array<{ title: string; hypothesis?: string; method?: string }>
    }
    feedback?: string
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
  theoretical_proof?: string
  isolation_test?: ExperimentIsolationTest
  post_mortem?: ExperimentPostMortem
  evidence_refs?: Array<ExperimentEvidenceRef | string>
  progress?: {
    epoch?: number
    total_epochs?: number
    current_metric?: string
    current_value?: number | string
  }
  parent?: string
  snapshot?: {
    title?: string
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
    theoretical_proof?: string
    isolation_test?: ExperimentIsolationTest
    post_mortem?: ExperimentPostMortem
    evidence_refs?: Array<ExperimentEvidenceRef | string>
    captured_at?: string
    source?: string
  }
}

export interface TaskPlanContract {
  profile: AgentProfile
  contract_version: ContractVersion
  required_completed_fields: string[]
  required_falsify_fields: string[]
  falsify_keywords: string[]
}

/* ── New Project creation ────────────────────────── */

export type AutomationGoalOperator = '>' | '>=' | '<' | '<=' | '=='
export type AutomationGoalLogic = 'AND' | 'OR'

export interface AutomationGoal {
  metric: string
  operator: AutomationGoalOperator
  value: number
}

export interface AutomationPolicy {
  logic: AutomationGoalLogic
  goals: AutomationGoal[]
  maxExperiments?: number
  maxTokens?: number
}

export type LiteratureSource =
  | 'pubmed'
  | 'google_scholar'
  | 'arxiv'
  | 'semantic_scholar'
  | 'crossref'
  | 'europe_pmc'

export interface LiteratureReviewOptions {
  enabled: boolean
  sources: LiteratureSource[]
}

export interface NewProjectInput {
  projectId?: string
  displayName?: string
  projectParentDir?: string
  projectDir?: string
  description: string
  title?: string
  domain?: string
  dataPath?: string
  references?: string
  computeBudget?: string
  literatureReview?: LiteratureReviewOptions
  automationPolicy?: AutomationPolicy
  agentProfile?: AgentProfile
  contractVersion?: ContractVersion
}

/* ── WebSocket protocol ─────────────────────────── */

export interface WsMessage {
  type: 'message' | 'command' | 'set_mode' | 'bind' | 'plan_answer' | 'plan_decision'
  content: string
  session_id: string
  user_id?: string
  media?: string[]
  loop_mode?: AppMode
  mode?: 'manual' | 'auto'
  agent_profile?: AgentProfile
  contract_version?: ContractVersion
  automation_policy?: AutomationPolicy
  allow_result_write?: boolean
  // Opt-in token streaming for this message (defaults on in the UI).
  stream?: boolean
  // Interactive plan-mode payloads.
  answers?: Record<string, string | string[]>
  decision?: 'approve' | 'revise'
  feedback?: string
}

export interface WsResponse {
  type: 'response' | 'progress' | 'tool_call' | 'error' | 'stream_delta' | 'stream_end'
  session_id?: string
  content: string
  media?: string[]
  metadata?: Record<string, unknown>
}

export type SkillPluginScope = 'global' | 'project'
export type SkillPluginTargetType = 'group' | 'skill'

export interface SkillPluginToggleState {
  global: boolean
  project: boolean | null
  effective: boolean
  global_explicit?: boolean
  project_explicit?: boolean
}

export interface SkillPluginGroup {
  id: string
  name: string
  skill_ids: string[]
  enabled: SkillPluginToggleState
  customized?: {
    global: boolean
    project: boolean
  }
}

export interface SkillPluginSkill {
  id: string
  name: string
  path: string
  group_ids: string[]
  enabled: SkillPluginToggleState
}

export interface SkillPlugin {
  id: string
  name: string
  version: string
  description: string
  install_path: string
  source: {
    type: string
    path: string
  }
  enabled: SkillPluginToggleState
  groups: SkillPluginGroup[]
  skills: SkillPluginSkill[]
}

export interface ProjectFileInfo {
  name: string
  path: string
  size: number
  mtime: number
  is_dir: boolean
}

/** File row in the explorer; includes project routing for workspace-wide views. */
export interface ProjectFileEntry extends ProjectFileInfo {
  projectId: string
  projectLabel?: string
  /** Path relative to the project root (used for API calls). */
  relativePath: string
}

export type FileExplorerScope = 'all' | 'project'
