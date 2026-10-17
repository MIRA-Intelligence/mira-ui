/* ── Pipeline stages ───────────────────────────── */

export type PipelineStage = 'modules' | 'research' | 'plan' | 'experiment' | 'result'
export type AppMode = 'normal' | 'project'
export type AgentProfile = 'engineer' | 'research' | 'team'
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
  /** Stable UI id is namespaced; these retain the Run-local identity. */
  experiment_id?: string
  workflow_run_id?: string
  workflow_run_label?: string
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
  /** Non-blocking guardrail warnings surfaced as a marker after the title. */
  guard_warnings?: string[]
}

/* ── Research data (literature & references) ───── */

export interface Reference {
  id: string
  title: string
  authors?: string
  year?: string
  source?: string
  venue?: string
  url?: string
  doi?: string
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

/* ── Plan revision audit (ReAct adaptive replanning) ── */

export type PlanRevisionAction = 'add' | 'skip' | 'remove' | 'reprioritize'

export interface PlanRevision {
  action: PlanRevisionAction
  target?: string
  rationale?: string
  sourceExperiment?: string
  at?: string
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
  revisions?: PlanRevision[]
  result: ResultData
  startedAt: string
}

/* ── Modular workflow v1 ───────────────────────── */

export type WorkflowModuleType = 'initiation' | 'planning' | 'experiment' | 'delivery'
// Workflows a user can start directly; planning is reached only as an upstream module.
export type StartableModuleType = Extract<WorkflowModuleType, 'initiation' | 'experiment' | 'delivery'>
export type WorkflowRunStatus =
  | 'created' | 'queued' | 'running' | 'waiting_input'
  | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowRun {
  schema_version: number
  workflow_contract_version: number
  run_id: string
  project_id: string
  module_type: WorkflowModuleType
  label: string
  status: WorkflowRunStatus
  revision: number
  created_at: string
  updated_at: string
  inputs: Array<{ artifact_id: string; expected_type?: string; supported_schema?: string }>
  outputs: string[]
  attempt: {
    current_attempt_id?: string | null
    number: number
    lease_owner?: string | null
    lease_expires_at?: string | null
  }
  attempts: Array<{
    attempt_id: string
    number: number
    lease_owner: string
    started_at: string
    ended_at?: string | null
    outcome: 'running' | 'waiting_input' | 'paused' | 'completed' | 'failed' | 'cancelled'
    resumed_from_checkpoint_id?: string | null
  }>
  pending_control?: 'pause' | 'cancel' | null
  conversation_key: string
  checkpoint_ref?: string | null
  last_project_sequence: number
  last_run_sequence: number
  module_data: Record<string, unknown>
}

export interface WorkflowInteraction {
  interaction_id: string
  interaction_type: string
  title: string
  prompt: string
  response_schema: Record<string, unknown>
  choices: Array<Record<string, unknown>>
  allow_freeform: boolean
  response?: unknown
  resolved_at?: string
}

export interface ProjectWorkflow {
  contract_version: number
  status: 'active' | 'archived'
  revision: number
  last_project_sequence: number
  selected_run_id?: string | null
  handoff_policy: {
    mode: 'manual' | 'auto'
    interrupt_grace_seconds: number
    rules: Array<Record<string, unknown>>
  }
}

export interface WorkflowSnapshot {
  workflow_contract_version: number
  project_id: string
  workflow: ProjectWorkflow
  runs: WorkflowRun[]
  project_sequence: number
}

export interface WorkflowArtifact {
  artifact_id: string
  artifact_type: string
  artifact_schema_version: number
  label: string
  media_type: string
  byte_size: number
  sha256: string
  payload_ref: string
  created_at: string
  derived_from: string[]
}

export interface WorkflowEvent {
  message_type: 'workflow_event'
  workflow_contract_version: number
  event_id: string
  project_id: string
  project_sequence: number
  run_id?: string | null
  run_sequence?: number | null
  event_type: string
  occurred_at: string
  project_revision: number
  run_revision?: number | null
  command_id?: string | null
  payload: Record<string, unknown>
}

export type WorkflowSocketMessage = WorkflowEvent | {
  message_type: 'subscribed' | 'snapshot_required' | 'protocol_error' | 'activity'
  project_id?: string
  subscription_id?: string
  watermark?: number
  run_id?: string
  summary?: string
  error?: { code: string; message: string; details?: Record<string, unknown> }
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
  revisions?: Array<{
    action?: string
    target?: string
    rationale?: string
    source_experiment?: string
    at?: string
  }>
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

export interface ResearchDirection {
  id: string
  title: string
  rationale: string
  tradeoffs?: string
  next_step?: string
}

export interface LiteratureSearchRecord {
  source: string
  query: string
  status: 'completed' | 'unavailable' | 'failed'
  result_count: number
  evidence_urls: string[]
  detail?: string
  searched_at: string
}

export interface InitiationResearchResult extends ResearchData {
  schema_version: 1
  searches: LiteratureSearchRecord[]
  gaps: string[]
  directions: ResearchDirection[]
  updated_at?: string
}

export interface NewProjectInput {
  allowExistingDir?: boolean
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
  type: 'message' | 'command' | 'set_mode' | 'bind' | 'plan_answer' | 'plan_decision' | 'stop' | 'skill_fallback_response'
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
  turn_id?: string
  request_id?: string
  selected_skill_ids?: string[]
  selected_kb_ids?: string[]
  approved?: boolean
  // Interactive plan-mode payloads.
  answers?: Record<string, string | string[]>
  decision?: 'approve' | 'revise'
  feedback?: string
  workflow_run_id?: string
  workflow_module_type?: WorkflowModuleType
}

export interface WsResponse {
  type: 'response' | 'progress' | 'tool_call' | 'error' | 'stream_delta' | 'stream_end' | 'stop_ack' | 'skill_fallback_required' | 'skill_loaded' | 'token_usage'
  session_id?: string
  content: string
  media?: string[]
  metadata?: Record<string, unknown>
}

export interface SkillLoadEvent {
  id: string
  loaded_at: string
  skill_name: string
  source: 'manual' | 'auto' | 'recent' | 'always' | 'read_file'
  partial: boolean
  run_id?: string | null
  module_type?: string | null
  turn_id?: string | null
  agent?: string | null
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
