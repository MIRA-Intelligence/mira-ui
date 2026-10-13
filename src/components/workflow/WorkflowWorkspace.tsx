import { useMemo, useState } from 'react'
import { JournalTargetSelect } from './JournalTargetSelect'
import { journalSelection, type JournalProfile } from '@/services/journals'

import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore } from '@/stores/uiStore'
import type {
  AutomationGoal,
  AutomationGoalLogic,
  AutomationGoalOperator,
  LiteratureSource,
  PipelineStage,
  WorkflowModuleType,
  WorkflowRun,
  WorkflowRunStatus,
} from '@/types'
import { cn } from '@/lib/utils'
import {
  buildExportMessage,
  getExportConfig,
  type ExportFormat,
} from '@/lib/exportRequests'
import { importWorkflowArtifact } from '@/services/api'
import { wsClient } from '@/services/websocket'
import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  type WorkflowCandidateItem,
} from '@/lib/workflowCandidates'
import { PipelineOverview } from './PipelineOverview'
import { ExperimentExecutionMode } from './ExperimentExecutionMode'
import { ExperimentContractMode } from './ExperimentContractMode'
import { ExperimentInputPaths } from './ExperimentInputPaths'
import { WorkflowDebugPanel } from './WorkflowDebugPanel'

const MODULES: Array<{
  type: WorkflowModuleType
  icon: string
  en: string
  zh: string
  enDescription: string
  zhDescription: string
}> = [
  {
    type: 'initiation', icon: '📚', en: 'Initiation', zh: '立项与调研',
    enDescription: 'Review literature, clarify the question, and propose research directions.',
    zhDescription: '调研文献、澄清问题并提出可选择的研究方向。',
  },
  {
    type: 'experiment', icon: '🔬', en: 'Experiment', zh: '实验',
    enDescription: 'Start directly from your own specification, data, or code.',
    zhDescription: '可跳过前序模块，直接从已有方案、数据或代码开始。',
  },
  {
    type: 'delivery', icon: '📝', en: 'Delivery', zh: '结果交付',
    enDescription: 'Write, polish, analyze, or package selected project artifacts.',
    zhDescription: '基于已有材料直接写作、润色、分析或整理交付物。',
  },
]

const GOAL_OPERATORS: AutomationGoalOperator[] = ['>', '>=', '<', '<=', '==']
const LITERATURE_SOURCE_OPTIONS: Array<{ key: LiteratureSource; label: string }> = [
  { key: 'pubmed', label: 'PubMed' },
  { key: 'google_scholar', label: 'Google Scholar' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'semantic_scholar', label: 'Semantic Scholar' },
  { key: 'crossref', label: 'Crossref' },
  { key: 'europe_pmc', label: 'Europe PMC' },
]
const DEFAULT_LITERATURE_SOURCES = LITERATURE_SOURCE_OPTIONS.map((source) => source.key)
const DELIVERY_FORMAT_OPTIONS: Array<{
  format: ExportFormat
  icon: string
  en: string
  zh: string
}> = [
  { format: 'experiment_report', icon: '📋', en: 'Experiment Report', zh: '实验报告' },
  { format: 'paper_article', icon: '📄', en: 'Journal Article (.docx)', zh: '期刊论文（.docx）' },
  { format: 'presentation', icon: '📊', en: 'Presentation (PDF)', zh: '演示文稿（PDF）' },
  { format: 'metadata', icon: '📦', en: 'Project Metadata (ZIP)', zh: '项目元数据（ZIP）' },
]

function detectPromptLanguage(text: string, fallback: 'zh' | 'en'): 'zh' | 'en' {
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  if (hanCount === 0 && latinCount === 0) return fallback
  return hanCount > 0 && hanCount * 2 >= latinCount ? 'zh' : 'en'
}

function buildModuleStartPrompt(
  moduleType: WorkflowModuleType,
  intent: string,
  moduleData: Record<string, unknown>,
  lang: 'zh' | 'en',
): string {
  if (moduleType !== 'initiation') return intent
  const literature = moduleData.literature_review as {
    enabled?: boolean
    sources?: LiteratureSource[]
  } | undefined
  const enabled = literature?.enabled !== false
  const sources = (literature?.sources ?? []).map(
    (key) => LITERATURE_SOURCE_OPTIONS.find((source) => source.key === key)?.label ?? key,
  )
  const references = typeof moduleData.references === 'string' ? moduleData.references : ''
  if (lang === 'zh') {
    return [
      '请执行本次立项与文献调研。',
      '',
      '## 本次目标',
      intent,
      '',
      '## 文献调研配置',
      `- 外部文献调研：${enabled ? '启用' : '停用'}`,
      `- 指定来源：${enabled ? (sources.join('、') || '未指定') : '不使用外部来源'}`,
      references ? `- 用户参考文献：\n${references}` : '- 用户参考文献：无',
      '',
      '请严格按照以上配置执行。若本次目标及已有确认尚未明确成果方向，先用交互表单轻量澄清希望调研帮助做出什么决定，允许用户选择由 AI 建议；目标明确则不重复询问。调研内容需要保留标题、作者、年份、来源、URL/DOI、摘要、相关性、冲突证据和研究空白，并提交到模块的结构化研究结果中。若目标包含后续研究或实验，归纳少量有证据依据的候选方向，说明可行性、风险和最小验证实验；若只要求综述或比较，不强制提出候选方向。',
      '除非用户明确要求其他语言，否则检索进度、结构化调研结果和最终回复均使用中文。',
      '结构化研究结果用于在中间工作区展示可审计的文献卡片。',
    ].join('\n')
  }
  return [
    'Run this initiation and literature-research module.',
    '',
    '## Run goal',
    intent,
    '',
    '## Literature research configuration',
    `- External literature research: ${enabled ? 'enabled' : 'disabled'}`,
    `- Selected sources: ${enabled ? (sources.join(', ') || 'none selected') : 'no external sources'}`,
    references ? `- User references:\n${references}` : '- User references: none',
    '',
    'Follow this configuration exactly. If the goal and prior decisions leave the intended output direction unclear, first use the interaction form to clarify what decision this research should support, including an option to let the AI suggest a focus. Do not re-ask when already clear. Preserve title, authors, year, source, URL/DOI, summary, relevance, conflicting evidence, and research gaps in the structured research result. For research or experiment-oriented goals, synthesize a few evidence-backed candidates with feasibility, risks, and a minimal validation experiment; do not force candidates for an overview/comparison-only request.',
    'Respond in English unless the user explicitly requests another language.',
    'The structured research result lets the center workspace render auditable reference cards.',
  ].join('\n')
}

const STATUS_STYLE: Record<WorkflowRunStatus, string> = {
  created: 'text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)]',
  queued: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10',
  running: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10',
  waiting_input: 'text-amber-500 bg-amber-500/10',
  paused: 'text-amber-500 bg-amber-500/10',
  completed: 'text-[var(--color-success)] bg-[var(--color-success)]/10',
  failed: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10',
  cancelled: 'text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)]',
}

function moduleMeta(type: WorkflowModuleType) {
  return MODULES.find((item) => item.type === type) ?? MODULES[0]
}

const NEXT_MODULE: Partial<Record<WorkflowModuleType, WorkflowModuleType>> = {
  initiation: 'experiment',
  experiment: 'delivery',
}

const MODULE_STAGE: Record<WorkflowModuleType, PipelineStage> = {
  initiation: 'research',
  planning: 'plan',
  experiment: 'experiment',
  delivery: 'result',
}

function RunControls({
  projectId,
  run,
  onStartRun,
}: {
  projectId: string
  run: WorkflowRun
  onStartRun: (run: WorkflowRun) => Promise<void>
}) {
  const commandRun = useWorkflowStore((state) => state.commandRun)
  const [pending, setPending] = useState(false)
  const [outputPath, setOutputPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lang = useSettingsStore((state) => state.language)
  const handoffMode = useWorkflowStore((state) => state.snapshots[projectId]?.workflow.handoff_policy.mode)
  const actions: Array<{ command: string; en: string; zh: string }> = []
  if (run.status === 'created') actions.push({ command: 'start_run', en: 'Start', zh: '开始' })
  if (run.status === 'queued') actions.push({ command: 'run_now', en: 'Run now', zh: '立即执行' })
  if (run.status === 'running' || run.status === 'waiting_input') {
    actions.push({ command: 'pause', en: 'Pause', zh: '暂停' })
  }
  if (run.status === 'paused') actions.push({ command: 'resume', en: 'Resume', zh: '继续' })
  if (!['completed', 'cancelled'].includes(run.status)) {
    actions.push({ command: 'cancel', en: 'Cancel', zh: '取消' })
  }
  if (run.status === 'failed') actions.push({ command: 'retry', en: 'Retry', zh: '重试' })
  if (run.status === 'running' || run.status === 'waiting_input' || run.status === 'paused') {
    actions.unshift({ command: 'complete', en: 'Mark complete', zh: '完成本模块' })
  }
  return (
    <div className="space-y-2">
      {(run.status === 'running' || run.status === 'waiting_input' || run.status === 'paused') && (
        <input
          value={outputPath}
          onChange={(event) => setOutputPath(event.target.value)}
          placeholder={lang === 'zh' ? '可选：项目内输出文件路径' : 'Optional: output file path inside Project'}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
        <button
          key={action.command}
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true)
            setError(null)
            void (async () => {
              if (action.command === 'start_run') {
                await commandRun(projectId, run.run_id, 'enqueue')
                await onStartRun(run)
              } else if (action.command === 'run_now') {
                await onStartRun(run)
              } else if (action.command === 'complete') {
                const outputs = outputPath.trim()
                  ? [(await importWorkflowArtifact(projectId, outputPath.trim())).artifact_id]
                  : []
                const nextModule = NEXT_MODULE[run.module_type]
                await commandRun(projectId, run.run_id, 'complete', {
                  outputs,
                  suggested_handoffs: handoffMode === 'auto' && nextModule
                    ? [{ target_module_type: nextModule, input_artifact_ids: outputs }]
                    : [],
                })
              } else {
                await commandRun(projectId, run.run_id, action.command)
              }
            })().catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason))
            }).finally(() => setPending(false))
          }}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          {lang === 'zh' ? action.zh : action.en}
        </button>
        ))}
      </div>
      {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}
    </div>
  )
}

export function WorkflowWorkspace() {
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const task = useProjectStore((state) => state.tasks.find((item) => item.id === state.selectedTaskId))
  const mode = useProjectStore((state) => state.mode)
  const agentProfile = useProjectStore((state) => state.agentProfile)
  const setActiveStage = useProjectStore((state) => state.setActiveStage)
  const lang = useSettingsStore((state) => state.language)
  const streamResponses = useSettingsStore((state) => state.streamResponses)
  const connected = useAgentStore((state) => state.connected)
  const setAgentPanelCollapsed = useUiStore((state) => state.setAgentPanelCollapsed)
  const snapshot = useWorkflowStore((state) => projectId ? state.snapshots[projectId] : undefined)
  const loading = useWorkflowStore((state) => projectId ? state.loadingByProject[projectId] : false)
  const error = useWorkflowStore((state) => projectId ? state.errorByProject[projectId] : null)
  const selectedRunId = useWorkflowStore((state) => projectId ? state.selectedRunByProject[projectId] : null)
  const activityByRun = useWorkflowStore((state) => state.activityByRun)
  const createRun = useWorkflowStore((state) => state.createRun)
  const selectRun = useWorkflowStore((state) => state.selectRun)
  const candidateSelections = useWorkflowStore((state) => (
    projectId ? state.selectedCandidateByProject[projectId] : undefined
  ))
  const setHandoffMode = useWorkflowStore((state) => state.setHandoffMode)
  const [creating, setCreating] = useState<WorkflowModuleType | null>(null)
  const [policyPending, setPolicyPending] = useState(false)
  const [startingModule, setStartingModule] = useState<WorkflowModuleType | null>(null)
  const [continuationSource, setContinuationSource] = useState<{
    parentRunId: string
    inputArtifactIds: string[]
    moduleType: WorkflowModuleType
    itemId: string
    label: string
  } | null>(null)
  const [runIntent, setRunIntent] = useState('')
  const [literatureResearchEnabled, setLiteratureResearchEnabled] = useState(true)
  const [selectedLiteratureSources, setSelectedLiteratureSources] = useState<LiteratureSource[]>(
    DEFAULT_LITERATURE_SOURCES,
  )
  const [references, setReferences] = useState('')
  const [goalLogic, setGoalLogic] = useState<AutomationGoalLogic>('AND')
  const [goals, setGoals] = useState<AutomationGoal[]>([])
  const [goalValueInputs, setGoalValueInputs] = useState<string[]>([])
  const [maxExperiments, setMaxExperiments] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [deliveryFormat, setDeliveryFormat] = useState<ExportFormat | null>(null)
  const [targetJournal, setTargetJournal] = useState<JournalProfile | null>(null)
  const [experimentMode, setExperimentMode] = useState<'auto' | 'manual'>('auto')
  const [experimentContractVersion, setExperimentContractVersion] = useState<1 | 2>(1)
  const [inputPaths, setInputPaths] = useState<string[]>([''])
  const [inputPathsValid, setInputPathsValid] = useState(true)
  const [startError, setStartError] = useState<string | null>(null)
  const selectedRun = useMemo(
    () => snapshot?.runs.find((run) => run.run_id === selectedRunId) ?? null,
    [selectedRunId, snapshot?.runs],
  )
  const selectedRunCandidates = useMemo(
    () => selectedRun && snapshot
      ? buildWorkflowCandidates(snapshot.runs, selectedRun.module_type)
      : [],
    [selectedRun, snapshot],
  )
  const selectedRunCandidate = selectedRun
    ? resolveWorkflowCandidate(
        selectedRunCandidates,
        candidateSelections?.[selectedRun.module_type],
        selectedRunId,
      )
    : null
  const mustSelectRunCandidate = selectedRunCandidates.length > 1 && !selectedRunCandidate
  const nextSelectedModule = selectedRun ? NEXT_MODULE[selectedRun.module_type] : undefined
  if (!projectId) return null

  const beginModule = (
    moduleType: WorkflowModuleType,
    sourceRun?: WorkflowRun,
    sourceCandidate?: WorkflowCandidateItem,
  ) => {
    setStartingModule(moduleType)
    setExperimentMode('auto')
    setExperimentContractVersion(1)
    setInputPaths([''])
    setInputPathsValid(true)
    setContinuationSource(sourceRun
      ? {
          parentRunId: sourceCandidate?.runId ?? sourceRun.run_id,
          inputArtifactIds: sourceCandidate?.artifactIds.length
            ? sourceCandidate.artifactIds
            : sourceRun.outputs,
          moduleType: sourceRun.module_type,
          itemId: sourceCandidate?.itemId ?? sourceRun.run_id,
          label: sourceCandidate?.label ?? sourceRun.label,
        }
      : null)
    const continuationIntent = lang === 'zh'
      ? `基于上游候选“${sourceCandidate?.label ?? sourceRun?.label ?? ''}”继续${moduleMeta(moduleType).zh}。`
      : `Continue with ${moduleMeta(moduleType).en.toLowerCase()} using the upstream candidate “${sourceCandidate?.label ?? sourceRun?.label ?? ''}”.`
    setRunIntent(sourceRun ? continuationIntent : (task?.coreQuestion?.trim() ?? ''))
    setLiteratureResearchEnabled(true)
    setSelectedLiteratureSources(DEFAULT_LITERATURE_SOURCES)
    setReferences('')
    setGoalLogic('AND')
    setGoals([])
    setGoalValueInputs([])
    setMaxExperiments('')
    setMaxTokens('')
    setDeliveryFormat(null)
    setStartError(null)
  }

  const startExistingRun = async (run: WorkflowRun) => {
    if (!connected || !wsClient.connected) {
      throw new Error(
        lang === 'zh'
          ? 'Agent 对话尚未连接，暂时无法启动模块。请等待连接后重试。'
          : 'Agent chat is not connected yet. Wait for the connection, then try again.',
      )
    }
    const configuredIntent = typeof run.module_data.intent === 'string'
      ? run.module_data.intent.trim()
      : ''
    const intent = configuredIntent || (
      lang === 'zh'
        ? `基于已继承的上游产物开始${moduleMeta(run.module_type).zh}。`
        : `Start ${moduleMeta(run.module_type).en.toLowerCase()} using the inherited upstream artifacts.`
    )
    const promptLanguage = detectPromptLanguage(intent, lang)
    const startPrompt = buildModuleStartPrompt(
      run.module_type,
      intent,
      run.module_data,
      promptLanguage,
    )
    const conversationId = `${projectId}:run:${run.run_id}`
    useAgentStore.getState().addLog(conversationId, {
      id: `module-start-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: startPrompt,
      type: 'response',
      metadata: {
        _user: true,
        workflow_run_id: run.run_id,
        workflow_module_type: run.module_type,
      },
    })
    useAgentStore.getState().markSessionPending(conversationId)
    setAgentPanelCollapsed(false)
    setActiveStage(MODULE_STAGE[run.module_type])
    wsClient.send({
      type: 'message',
      content: startPrompt,
      session_id: projectId,
      user_id: 'ui_user',
      loop_mode: 'project',
      stream: streamResponses,
      mode,
      agent_profile: agentProfile,
      workflow_run_id: run.run_id,
      workflow_module_type: run.module_type,
    })
  }

  const startModuleRun = async () => {
    if (!startingModule) return
    const intent = runIntent.trim()
    if (!intent) {
      setStartError(lang === 'zh' ? '请先填写本次运行的目标。' : 'Describe the goal for this run.')
      return
    }

    const moduleData: Record<string, unknown> = {
      confirmation_policy: { mode: 'required' },
    }
    if (continuationSource) {
      moduleData.upstream_selection = {
        module_type: continuationSource.moduleType,
        run_id: continuationSource.parentRunId,
        item_id: continuationSource.itemId,
        label: continuationSource.label,
      }
    }
    if (startingModule === 'initiation') {
      if (literatureResearchEnabled && selectedLiteratureSources.length === 0) {
        setStartError(
          lang === 'zh'
            ? '启用外部文献调研时，请至少选择一个文献来源。'
            : 'Choose at least one literature source when external research is enabled.',
        )
        return
      }
      moduleData.literature_review = {
        enabled: literatureResearchEnabled,
        sources: selectedLiteratureSources,
      }
      if (references.trim()) moduleData.references = references.trim()
    }
    if (startingModule === 'experiment') {
      if (!inputPathsValid) return
      moduleData.experiment_execution_mode = experimentMode
      moduleData.experiment_contract_version = experimentContractVersion
      const paths = [...new Set(inputPaths.map((p) => p.trim()).filter(Boolean))]
      if (paths.length) moduleData.external_read_paths = paths
      const normalizedGoals: AutomationGoal[] = []
      for (let index = 0; index < goals.length; index += 1) {
        const metric = goals[index].metric.trim()
        const rawValue = goalValueInputs[index]?.trim() ?? ''
        if (!metric && !rawValue) continue
        const value = Number(rawValue)
        if (!metric || !rawValue || !Number.isFinite(value)) {
          setStartError(
            lang === 'zh'
              ? '请完整填写每个停止条件的指标和值。'
              : 'Complete both the metric and value for every stopping condition.',
          )
          return
        }
        normalizedGoals.push({ ...goals[index], metric, value })
      }
      const parsePositiveInteger = (raw: string, label: string) => {
        if (!raw.trim()) return undefined
        const value = Number(raw)
        if (!Number.isInteger(value) || value <= 0) throw new Error(label)
        return value
      }
      try {
        const maxExperimentsValue = parsePositiveInteger(
          maxExperiments,
          lang === 'zh' ? '实验最大次数必须是正整数。' : 'Maximum experiments must be a positive integer.',
        )
        const maxTokensValue = parsePositiveInteger(
          maxTokens,
          lang === 'zh' ? 'Token 上限必须是正整数。' : 'Token limit must be a positive integer.',
        )
        moduleData.automation_policy = {
          logic: goalLogic,
          goals: normalizedGoals,
          ...(maxExperimentsValue ? { maxExperiments: maxExperimentsValue } : {}),
          ...(maxTokensValue ? { maxTokens: maxTokensValue } : {}),
        }
      } catch (reason) {
        setStartError(reason instanceof Error ? reason.message : String(reason))
        return
      }
    }
    if (startingModule === 'delivery') {
      if (!deliveryFormat) {
        setStartError(
          lang === 'zh' ? '请选择需要的交付物形式。' : 'Choose a deliverable format.',
        )
        return
      }
      const config = getExportConfig(deliveryFormat)
      moduleData.delivery_format = deliveryFormat
      if (deliveryFormat === 'paper_article') Object.assign(moduleData, journalSelection(targetJournal))
      moduleData.output_path = config.outputPath
      moduleData.output_type = config.outputType
    }
    if (!connected || !wsClient.connected) {
      setStartError(
        lang === 'zh'
          ? 'Agent 对话尚未连接，暂时无法启动模块。请等待连接后重试。'
          : 'Agent chat is not connected yet. Wait for the connection, then try again.',
      )
      return
    }

    const moduleType = startingModule
    setCreating(moduleType)
    setStartError(null)
    try {
      const runId = await createRun(projectId, moduleType, intent, {
        enqueue: true,
        moduleData,
        inputArtifactIds: continuationSource?.inputArtifactIds,
        parentRunId: continuationSource?.parentRunId,
      })
      const conversationId = `${projectId}:run:${runId}`
      const promptLanguage = detectPromptLanguage(
        `${intent}\n${typeof moduleData.references === 'string' ? moduleData.references : ''}`,
        lang,
      )
      const startPrompt = moduleType === 'delivery' && deliveryFormat && task
        ? `${intent}\n\n${buildExportMessage(task, deliveryFormat, { workflow: true, targetJournal: targetJournal?.id })}`
        : buildModuleStartPrompt(moduleType, intent, moduleData, promptLanguage)
      useAgentStore.getState().addLog(conversationId, {
        id: `module-start-${Date.now()}`,
        timestamp: new Date().toISOString(),
        content: startPrompt,
        type: 'response',
        metadata: { _user: true, workflow_run_id: runId, workflow_module_type: moduleType },
      })
      useAgentStore.getState().markSessionPending(conversationId)
      setAgentPanelCollapsed(false)
      setActiveStage(MODULE_STAGE[moduleType])
      wsClient.send({
        type: 'message',
        content: startPrompt,
        session_id: projectId,
        user_id: 'ui_user',
        loop_mode: 'project',
        stream: streamResponses,
        mode,
        agent_profile: agentProfile,
        workflow_run_id: runId,
        workflow_module_type: moduleType,
      })
      setStartingModule(null)
      setContinuationSource(null)
      setDeliveryFormat(null)
      setRunIntent('')
    } catch (reason) {
      setStartError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 p-6 xl:h-full xl:min-h-0">
        <div className="flex justify-end">
          {snapshot && (
            <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <span>{lang === 'zh' ? '模块完成后' : 'After completion'}</span>
              <select
                value={snapshot.workflow.handoff_policy.mode}
                disabled={policyPending}
                onChange={(event) => {
                  setPolicyPending(true)
                  void setHandoffMode(projectId, event.target.value as 'manual' | 'auto')
                    .finally(() => setPolicyPending(false))
                }}
                className="bg-transparent font-medium text-[var(--color-accent)] outline-none"
              >
                <option value="manual">{lang === 'zh' ? '由我选择下一步' : 'Let me choose'}</option>
                <option value="auto">{lang === 'zh' ? '自动创建建议模块' : 'Create suggested Run'}</option>
              </select>
            </label>
          )}
        </div>

        <PipelineOverview
          projectId={projectId}
          runs={snapshot?.runs ?? []}
          disabled={creating !== null || snapshot?.workflow.status === 'archived'}
          onStartModule={(moduleType) => beginModule(moduleType)}
          onContinue={(moduleType, candidate) => {
            const sourceRun = snapshot?.runs.find((run) => run.run_id === candidate.runId)
            if (sourceRun) beginModule(moduleType, sourceRun, candidate)
          }}
          onOpen={(candidate) => {
            selectRun(projectId, candidate.runId)
            if (candidate.kind === 'experiment') {
              useProjectStore.getState().selectExperiment(`workflow:${candidate.runId}:${candidate.itemId}`)
            }
            setActiveStage(MODULE_STAGE[candidate.moduleType])
          }}
        />
      </div>

        {startingModule && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="module-start-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && creating === null) {
                setStartingModule(null)
                setContinuationSource(null)
              }
            }}
          >
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{moduleMeta(startingModule).icon}</div>
                <div className="min-w-0 flex-1">
                  <h3 id="module-start-title" className="text-base font-semibold text-[var(--color-text-primary)]">
                    {lang === 'zh'
                      ? `启动${moduleMeta(startingModule).zh}`
                      : `Start ${moduleMeta(startingModule).en}`}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {lang === 'zh'
                      ? '说明这次运行希望 Mira 完成什么。确认后会立即创建 ModuleRun、进入模块工作页并开始执行。'
                      : 'Describe what Mira should accomplish. Confirming creates the ModuleRun, opens its workspace, and starts execution immediately.'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={lang === 'zh' ? '关闭' : 'Close'}
                  disabled={creating !== null}
                  onClick={() => {
                    setStartingModule(null)
                    setContinuationSource(null)
                  }}
                  className="rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                >
                  ×
                </button>
              </div>

              <label className="mt-5 block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="module-run-intent">
                {lang === 'zh' ? '本次运行目标' : 'Goal for this run'}
              </label>
              <textarea
                id="module-run-intent"
                autoFocus
                value={runIntent}
                disabled={creating !== null}
                onChange={(event) => setRunIntent(event.target.value)}
                placeholder={lang === 'zh' ? '例如：调研该方向近三年的关键论文，并提出三个可验证的研究方向。' : 'Example: Review the last three years of key papers and propose three testable directions.'}
                className="mt-2 min-h-32 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
              />

              {continuationSource && (
                <div className="mt-3 rounded-xl border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5 p-3 text-xs text-[var(--color-text-secondary)]">
                  <div className="font-medium text-[var(--color-accent)]">
                    {lang === 'zh' ? '从上游结果创建新分支' : 'Create a new branch from upstream results'}
                  </div>
                  <div className="mt-1">
                    {lang === 'zh'
                      ? `已选择“${continuationSource.label}”，将继承 ${continuationSource.inputArtifactIds.length} 个产物；确认后立即启动执行。`
                      : `Selected “${continuationSource.label}”. Inherits ${continuationSource.inputArtifactIds.length} artifact(s) and starts execution immediately after confirmation.`}
                  </div>
                </div>
              )}

              {startingModule === 'initiation' && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
                    <label className="flex items-start gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={literatureResearchEnabled}
                        disabled={creating !== null}
                        onChange={(event) => setLiteratureResearchEnabled(event.target.checked)}
                        className="mt-0.5 accent-[var(--color-accent)]"
                      />
                      <span>
                        {lang === 'zh' ? '启用外部文献调研' : 'Enable external literature research'}
                        <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-text-muted)]">
                          {lang === 'zh'
                            ? '关闭后 Mira 只使用你提供的参考文献和项目材料。'
                            : 'When disabled, Mira only uses your references and project materials.'}
                        </span>
                      </span>
                    </label>
                    <div className={cn(
                      'mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3',
                      !literatureResearchEnabled && 'opacity-50',
                    )}>
                      {LITERATURE_SOURCE_OPTIONS.map((source) => (
                        <label
                          key={source.key}
                          className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-xs text-[var(--color-text-secondary)]"
                        >
                          <input
                            type="checkbox"
                            checked={selectedLiteratureSources.includes(source.key)}
                            disabled={creating !== null || !literatureResearchEnabled}
                            onChange={() => setSelectedLiteratureSources((current) => (
                              current.includes(source.key)
                                ? current.filter((item) => item !== source.key)
                                : [...current, source.key]
                            ))}
                            className="accent-[var(--color-accent)]"
                          />
                          {source.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="module-run-references">
                      {lang === 'zh' ? '用户参考文献' : 'Your references'}
                    </label>
                    <textarea
                      id="module-run-references"
                      value={references}
                      disabled={creating !== null}
                      onChange={(event) => setReferences(event.target.value)}
                      placeholder={lang === 'zh'
                        ? '输入 DOI、论文链接或引文；可每行一条。'
                        : 'Enter DOIs, paper links, or citations; one per line is fine.'}
                      className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              {startingModule === 'experiment' && (
                <div className="mt-4 space-y-4">
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <ExperimentExecutionMode value={experimentMode} onChange={setExperimentMode} disabled={creating !== null} />
                    <ExperimentContractMode value={experimentContractVersion} onChange={setExperimentContractVersion} disabled={creating !== null} />
                  </div>
                  <ExperimentInputPaths paths={inputPaths} onChange={setInputPaths} onValidChange={setInputPathsValid} disabled={creating !== null} />
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        {lang === 'zh' ? '停止条件' : 'Stopping conditions'}
                      </label>
                      <div className="flex gap-1">
                        {(['AND', 'OR'] as AutomationGoalLogic[]).map((logic) => (
                          <button
                            key={logic}
                            type="button"
                            disabled={creating !== null}
                            onClick={() => setGoalLogic(logic)}
                            className={cn(
                              'rounded-md border px-2 py-1 text-[11px] font-medium',
                              goalLogic === logic
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
                            )}
                          >
                            {logic}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 space-y-2">
                      {goals.map((goal, index) => (
                        <div key={`module-goal-${index}`} className="grid grid-cols-[minmax(0,1fr)_70px_100px_auto] gap-2">
                          <input
                            aria-label={`${lang === 'zh' ? '停止指标' : 'Stopping metric'} ${index + 1}`}
                            value={goal.metric}
                            disabled={creating !== null}
                            onChange={(event) => setGoals((current) => current.map((item, itemIndex) => (
                              itemIndex === index ? { ...item, metric: event.target.value } : item
                            )))}
                            placeholder={lang === 'zh' ? '指标，如 accuracy' : 'Metric, e.g. accuracy'}
                            className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                          />
                          <select
                            aria-label={`${lang === 'zh' ? '停止条件运算符' : 'Stopping operator'} ${index + 1}`}
                            value={goal.operator}
                            disabled={creating !== null}
                            onChange={(event) => setGoals((current) => current.map((item, itemIndex) => (
                              itemIndex === index
                                ? { ...item, operator: event.target.value as AutomationGoalOperator }
                                : item
                            )))}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-2 text-xs text-[var(--color-text-primary)] outline-none"
                          >
                            {GOAL_OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
                          </select>
                          <input
                            aria-label={`${lang === 'zh' ? '停止目标值' : 'Stopping value'} ${index + 1}`}
                            value={goalValueInputs[index] ?? ''}
                            disabled={creating !== null}
                            inputMode="decimal"
                            onChange={(event) => setGoalValueInputs((current) => current.map((item, itemIndex) => (
                              itemIndex === index ? event.target.value : item
                            )))}
                            placeholder={lang === 'zh' ? '目标值' : 'Value'}
                            className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                          />
                          <button
                            type="button"
                            aria-label={lang === 'zh' ? `删除停止条件 ${index + 1}` : `Remove stopping condition ${index + 1}`}
                            disabled={creating !== null}
                            onClick={() => {
                              setGoals((current) => current.filter((_, itemIndex) => itemIndex !== index))
                              setGoalValueInputs((current) => current.filter((_, itemIndex) => itemIndex !== index))
                            }}
                            className="rounded-lg border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={creating !== null}
                      onClick={() => {
                        setGoals((current) => [...current, { metric: '', operator: '>', value: Number.NaN }])
                        setGoalValueInputs((current) => [...current, ''])
                      }}
                      className="mt-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                    >
                      {lang === 'zh' ? '+ 添加停止条件' : '+ Add stopping condition'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                      {lang === 'zh' ? '实验最大次数' : 'Maximum experiments'}
                      <input
                        value={maxExperiments}
                        disabled={creating !== null}
                        inputMode="numeric"
                        onChange={(event) => setMaxExperiments(event.target.value)}
                        placeholder={lang === 'zh' ? '可选，如 10' : 'Optional, e.g. 10'}
                        className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      />
                    </label>
                    <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                      {lang === 'zh' ? 'Token 上限' : 'Token limit'}
                      <input
                        value={maxTokens}
                        disabled={creating !== null}
                        inputMode="numeric"
                        onChange={(event) => setMaxTokens(event.target.value)}
                        placeholder={lang === 'zh' ? '可选，如 50000' : 'Optional, e.g. 50000'}
                        className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      />
                    </label>
                  </div>
                </div>
              )}

              {startingModule === 'delivery' && (
                <fieldset className="mt-4">
                  <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {lang === 'zh' ? '选择交付物形式' : 'Choose deliverable format'}
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {DELIVERY_FORMAT_OPTIONS.map((option) => {
                      const config = getExportConfig(option.format)
                      const active = deliveryFormat === option.format
                      return (
                        <button
                          key={option.format}
                          type="button"
                          aria-pressed={active}
                          disabled={creating !== null}
                          onClick={() => {
                            setDeliveryFormat(option.format)
                            setStartError(null)
                          }}
                          className={cn(
                            'rounded-xl border p-3 text-left',
                            active
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                              : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-hover)]',
                          )}
                        >
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {option.icon} {lang === 'zh' ? option.zh : option.en}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                            {config.outputPath}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {deliveryFormat === 'paper_article' && <JournalTargetSelect value={targetJournal} onChange={setTargetJournal} disabled={creating !== null} />}
                </fieldset>
              )}

              {startError && (
                <div className="mt-3 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
                  {startError}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={creating !== null}
                  onClick={() => {
                    setStartingModule(null)
                    setContinuationSource(null)
                  }}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={
                    creating !== null
                    || runIntent.trim().length === 0
                    || (startingModule === 'experiment' && !inputPathsValid)
                    || (startingModule === 'delivery' && !deliveryFormat)
                  }
                  onClick={() => void startModuleRun()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {creating === startingModule
                    ? (lang === 'zh' ? '正在启动…' : 'Starting…')
                    : (lang === 'zh' ? '启动并进入模块' : 'Start and open module')}
                </button>
              </div>
            </div>
          </div>
        )}

      <div className="mx-auto max-w-6xl space-y-6 px-6 pb-6">
        {error && (
          <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {/* Temporary legacy inspector: keep separate from the primary pipeline UI. */}
        <WorkflowDebugPanel key={projectId}>
          <div className="grid min-h-80 gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.2fr)]">
            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="border-b border-[var(--color-border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {lang === 'zh' ? '模块运行' : 'Module runs'}
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {loading && !snapshot && <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>}
                {snapshot?.runs.length === 0 && (
                  <div className="p-5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {lang === 'zh' ? '还没有运行。请从上方选择任意模块开始。' : 'No runs yet. Choose any module above to begin.'}
                  </div>
                )}
                {snapshot?.runs.slice().reverse().map((run) => {
                  const meta = moduleMeta(run.module_type)
                  return (
                    <button
                      key={run.run_id}
                      type="button"
                      onClick={() => selectRun(projectId, run.run_id)}
                      className={cn(
                        'w-full px-4 py-3 text-left hover:bg-[var(--color-bg-hover)]',
                        selectedRunId === run.run_id && 'bg-[var(--color-accent)]/5',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span>{meta.icon}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{run.label}</span>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLE[run.status])}>
                          {run.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-1 truncate pl-7 text-[10px] font-mono text-[var(--color-text-muted)]">{run.run_id}</div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
              {!selectedRun ? (
                <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
                  {lang === 'zh' ? '选择一个 ModuleRun 查看和控制' : 'Select a ModuleRun to inspect and control'}
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{moduleMeta(selectedRun.module_type).icon}</div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{selectedRun.label}</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {lang === 'zh' ? moduleMeta(selectedRun.module_type).zhDescription : moduleMeta(selectedRun.module_type).enDescription}
                      </p>
                    </div>
                  </div>

                  {activityByRun[selectedRun.run_id] && (
                    <div className="truncate rounded-md bg-[var(--color-accent)]/8 px-3 py-2 text-xs text-[var(--color-accent)]">
                      {activityByRun[selectedRun.run_id]}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-[var(--color-bg-tertiary)] p-3">
                      <div className="text-[var(--color-text-muted)]">{lang === 'zh' ? '状态' : 'Status'}</div>
                      <div className="mt-1 font-medium text-[var(--color-text-primary)]">{selectedRun.status.replace('_', ' ')}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--color-bg-tertiary)] p-3">
                      <div className="text-[var(--color-text-muted)]">{lang === 'zh' ? '版本' : 'Revision'}</div>
                      <div className="mt-1 font-mono text-[var(--color-text-primary)]">{selectedRun.revision}</div>
                    </div>
                  </div>

                  {typeof selectedRun.module_data.intent === 'string' && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                        {lang === 'zh' ? '本次目标' : 'Run intent'}
                      </div>
                      <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                        {selectedRun.module_data.intent}
                      </div>
                    </div>
                  )}

                  {Boolean(selectedRun.module_data.recovery) && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600">
                      {lang === 'zh'
                        ? '检测到上一次执行在安全边界确认前中断。为避免重复外部操作，本模块已暂停；请检查当前材料后再点击“继续”。'
                        : 'The previous attempt ended before confirming a safe boundary. This Run is paused to avoid repeating uncertain external work; inspect it before choosing Resume.'}
                    </div>
                  )}

                  {selectedRun.module_data.auto_handoff === true && (
                    <div className="rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      {lang === 'zh'
                        ? '这是根据 Project 衔接策略自动创建的下游 Run。宽限期内你可以取消；之后发送消息即可开始。'
                        : 'This downstream Run was created by the Project handoff policy. You may cancel it during the grace period, then start it by sending a message.'}
                    </div>
                  )}

                  {(selectedRun.checkpoint_ref || selectedRun.attempts.length > 0) && (
                    <div className="rounded-lg border border-[var(--color-border)] p-3 text-xs">
                      <div className="font-medium text-[var(--color-text-secondary)]">
                        {lang === 'zh' ? '恢复状态' : 'Recovery state'}
                      </div>
                      <div className="mt-1 text-[var(--color-text-muted)]">
                        {lang === 'zh' ? `已记录 ${selectedRun.attempts.length} 次执行` : `${selectedRun.attempts.length} execution attempt(s) recorded`}
                        {selectedRun.checkpoint_ref && (
                          <span className="ml-2 font-mono">checkpoint {selectedRun.checkpoint_ref.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                  )}

                  <RunControls projectId={projectId} run={selectedRun} onStartRun={startExistingRun} />

                  {selectedRun.status === 'completed' && nextSelectedModule && (
                    <div>
                      <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
                        {lang === 'zh' ? '从此结果继续（创建新分支）' : 'Continue from this result (new branch)'}
                      </div>
                      {mustSelectRunCandidate && (
                        <div className="mb-2 text-[10px] text-amber-600">
                          {lang === 'zh'
                            ? '请先在上方 Pipeline 中选择一个候选 item。'
                            : 'Select one candidate item in the pipeline above first.'}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={creating !== null || mustSelectRunCandidate
                            || (selectedRunCandidate?.kind === 'experiment' && selectedRunCandidate.status !== 'completed')}
                          onClick={() => beginModule(
                            nextSelectedModule,
                            selectedRun,
                            selectedRunCandidate ?? undefined,
                          )}
                          className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                        >
                          {moduleMeta(nextSelectedModule).icon}{' '}
                          {lang === 'zh' ? moduleMeta(nextSelectedModule).zh : moduleMeta(nextSelectedModule).en}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </WorkflowDebugPanel>
      </div>
    </div>
  )
}
