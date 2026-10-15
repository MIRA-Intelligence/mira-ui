import { useEffect, useMemo, useRef, useState } from 'react'
import { JournalTargetSelect } from './JournalTargetSelect'
import { journalSelection, type JournalProfile } from '@/services/journals'

import { t } from '@/i18n'
import {
  buildExportMessage,
  getExportConfig,
  type ExportFormat,
} from '@/lib/exportRequests'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { PipelineStage, WorkflowModuleType, WorkflowRun } from '@/types'
import { buildWorkflowCandidates, resolveWorkflowCandidate } from '@/lib/workflowCandidates'
import { WorkflowCandidateList } from './WorkflowCandidateList'
import { WorkflowInteractionPanel } from './WorkflowInteractionPanel'
import { ExperimentExecutionMode } from './ExperimentExecutionMode'
import { ExperimentContractMode } from './ExperimentContractMode'
import { ExperimentInputPaths } from './ExperimentInputPaths'

const MODULE_META: Record<WorkflowModuleType, {
  icon: string
  en: string
  zh: string
  stage: PipelineStage
}> = {
  initiation: { icon: '📚', en: 'Initiation', zh: '立项与调研', stage: 'research' },
  planning: { icon: '🗺️', en: 'Planning', zh: '规划', stage: 'plan' },
  experiment: { icon: '🔬', en: 'Experiment', zh: '实验', stage: 'experiment' },
  delivery: { icon: '📝', en: 'Delivery', zh: '结果交付', stage: 'result' },
}

const DOWNSTREAM_MODULES: Record<WorkflowModuleType, WorkflowModuleType[]> = {
  initiation: ['experiment'],
  planning: ['experiment'],
  experiment: ['delivery'],
  delivery: [],
}

const DELIVERY_FORMATS: Array<{
  format: ExportFormat
  icon: string
  labelKey:
    | 'exportFormatReport'
    | 'exportFormatPaper'
    | 'exportFormatPresentation'
    | 'exportFormatSlides'
    | 'exportFormatNotebook'
    | 'exportFormatMetadata'
}> = [
  { format: 'experiment_report', icon: '📋', labelKey: 'exportFormatReport' },
  { format: 'paper_article', icon: '📄', labelKey: 'exportFormatPaper' },
  { format: 'presentation', icon: '📊', labelKey: 'exportFormatPresentation' },
  { format: 'slides', icon: '🎞️', labelKey: 'exportFormatSlides' },
  { format: 'notebook', icon: '📓', labelKey: 'exportFormatNotebook' },
  { format: 'metadata', icon: '📦', labelKey: 'exportFormatMetadata' },
]

function startPromptFor(
  task: NonNullable<ReturnType<typeof useProjectStore.getState>['tasks'][number]>,
  moduleType: WorkflowModuleType,
  intent: string,
  deliveryFormat: ExportFormat | null,
  targetJournal?: string,
): string {
  if (moduleType !== 'delivery' || !deliveryFormat) return intent
  return `${intent}\n\n${buildExportMessage(task, deliveryFormat, { workflow: true, targetJournal })}`
}

export function ModuleStageControls() {
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const activeStage = useProjectStore((state) => state.activeStage)
  const task = useProjectStore((state) => (
    state.tasks.find((item) => item.id === state.selectedTaskId)
  ))
  const mode = useProjectStore((state) => state.mode)
  const agentProfile = useProjectStore((state) => state.agentProfile)
  const setActiveStage = useProjectStore((state) => state.setActiveStage)
  const lang = useSettingsStore((state) => state.language)
  const streamResponses = useSettingsStore((state) => state.streamResponses)
  const connected = useAgentStore((state) => state.connected)
  const setAgentPanelCollapsed = useUiStore((state) => state.setAgentPanelCollapsed)
  const snapshot = useWorkflowStore((state) => (
    projectId ? state.snapshots[projectId] : undefined
  ))
  const selectedRunId = useWorkflowStore((state) => (
    projectId ? state.selectedRunByProject[projectId] : null
  ))
  const candidateSelections = useWorkflowStore((state) => (
    projectId ? state.selectedCandidateByProject[projectId] : undefined
  ))
  const createRun = useWorkflowStore((state) => state.createRun)
  const selectRun = useWorkflowStore((state) => state.selectRun)
  const selectedRun = useMemo(
    () => {
      const stageRuns = snapshot?.runs.filter((run) => MODULE_META[run.module_type].stage === activeStage) ?? []
      const current = stageRuns.find((run) => run.run_id === selectedRunId)
      if (current) return current
      // A stage tab changes the surface, not the global Run selection. Restore
      // that stage's choice before rendering its controls and conversation.
      const remembered = stageRuns.find((run) => candidateSelections?.[run.module_type]?.runId === run.run_id)
      if (remembered) return remembered
      const latest = stageRuns.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      return latest.find((run) => run.status === 'waiting_input') ?? latest[0]
    },
    [activeStage, candidateSelections, selectedRunId, snapshot?.runs],
  )
  useEffect(() => {
    if (projectId && selectedRun && selectedRun.run_id !== selectedRunId) {
      selectRun(projectId, selectedRun.run_id)
    }
  }, [projectId, selectedRun, selectedRunId, selectRun])
  const controlsRef = useRef<HTMLDivElement>(null)
  const interactionId = (selectedRun?.module_data.interaction as { interaction_id?: string } | undefined)?.interaction_id
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.scrollTop = 0
  }, [selectedRun?.run_id, selectedRun?.status, interactionId])
  const moduleCandidates = useMemo(
    () => selectedRun && snapshot
      ? buildWorkflowCandidates(snapshot.runs, selectedRun.module_type)
      : [],
    [selectedRun, snapshot],
  )
  const selectedCandidate = selectedRun
    ? resolveWorkflowCandidate(
        moduleCandidates,
        candidateSelections?.[selectedRun.module_type],
        selectedRun.run_id,
      )
    : null
  const [targetModule, setTargetModule] = useState<WorkflowModuleType | null>(null)
  const [intent, setIntent] = useState('')
  const [deliveryFormat, setDeliveryFormat] = useState<ExportFormat | null>(null)
  const [targetJournal, setTargetJournal] = useState<JournalProfile | null>(null)
  const [experimentMode, setExperimentMode] = useState<'auto' | 'manual'>('auto')
  const [experimentContractVersion, setExperimentContractVersion] = useState<1 | 2>(1)
  const [inputPaths, setInputPaths] = useState<string[]>([''])
  const [inputPathsValid, setInputPathsValid] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidateListCollapsed, setCandidateListCollapsed] = useState(false)

  if (
    !projectId
    || !task
    || !selectedRun
    || MODULE_META[selectedRun.module_type].stage !== activeStage
  ) return null

  const downstream = DOWNSTREAM_MODULES[selectedRun.module_type]
  const interactionVisible = Boolean(selectedRun.status === 'waiting_input'
    && selectedRun.module_data.interaction
    && typeof selectedRun.module_data.interaction === 'object'
    && (selectedRun.module_data.interaction as { response?: unknown }).response == null)
  const mustSelectCandidate = moduleCandidates.length > 1 && !selectedCandidate
  const selectedExperimentIncomplete = selectedCandidate?.kind === 'experiment' && selectedCandidate.status !== 'completed'

  const openTarget = (moduleType: WorkflowModuleType) => {
    const label = lang === 'zh' ? MODULE_META[moduleType].zh : MODULE_META[moduleType].en.toLowerCase()
    setTargetModule(moduleType)
    setExperimentMode('auto')
    setExperimentContractVersion(1)
    setInputPaths([''])
    setInputPathsValid(true)
    setIntent(
      lang === 'zh'
        ? `基于上游候选“${selectedCandidate?.label ?? selectedRun.label}”继续${label}。`
        : `Continue with ${label} using the selected upstream candidate “${selectedCandidate?.label ?? selectedRun.label}”.`,
    )
    setDeliveryFormat(null)
    setError(null)
  }

  const closeDialog = () => {
    if (pending) return
    setTargetModule(null)
    setDeliveryFormat(null)
    setError(null)
  }

  const startDownstreamRun = async () => {
    if (!targetModule) return
    if (targetModule === 'experiment' && !inputPathsValid) return
    const normalizedIntent = intent.trim()
    if (!normalizedIntent) {
      setError(lang === 'zh' ? '请填写本次运行目标。' : 'Describe the goal for this run.')
      return
    }
    if (targetModule === 'delivery' && !deliveryFormat) {
      setError(lang === 'zh' ? '请选择需要的交付物形式。' : 'Choose a deliverable format.')
      return
    }
    if (!connected || !wsClient.connected) {
      setError(
        lang === 'zh'
          ? 'Agent 对话尚未连接，请等待连接后重试。'
          : 'Agent chat is not connected. Wait for it to reconnect and try again.',
      )
      return
    }

    const moduleData: Record<string, unknown> = {
      confirmation_policy: { mode: 'required' },
    }
    if (targetModule === 'experiment') {
      moduleData.experiment_execution_mode = experimentMode
      moduleData.experiment_contract_version = experimentContractVersion
      const paths = [...new Set(inputPaths.map((p) => p.trim()).filter(Boolean))]
      if (paths.length) moduleData.external_read_paths = paths
    }
    if (selectedCandidate) {
      moduleData.upstream_selection = {
        module_type: selectedRun.module_type,
        run_id: selectedCandidate.runId,
        item_id: selectedCandidate.itemId,
        label: selectedCandidate.label,
      }
    }
    if (targetModule === 'delivery' && deliveryFormat) {
      const config = getExportConfig(deliveryFormat)
      moduleData.delivery_format = deliveryFormat
      moduleData.output_path = config.outputPath
      moduleData.output_type = config.outputType
      if (deliveryFormat === 'paper_article') Object.assign(moduleData, journalSelection(targetJournal))
    }
    setPending(true)
    setError(null)
    try {
      const runId = await createRun(projectId, targetModule, normalizedIntent, {
        enqueue: true,
        moduleData,
        inputArtifactIds: selectedCandidate?.artifactIds.length
          ? selectedCandidate.artifactIds
          : selectedRun.outputs,
        parentRunId: selectedCandidate?.runId ?? selectedRun.run_id,
      })
      const prompt = startPromptFor(task, targetModule, normalizedIntent, deliveryFormat, targetJournal?.id)
      const conversationId = `${projectId}:run:${runId}`
      useAgentStore.getState().addLog(conversationId, {
        id: `module-start-${Date.now()}`,
        timestamp: new Date().toISOString(),
        content: prompt,
        type: 'response',
        metadata: {
          _user: true,
          workflow_run_id: runId,
          workflow_module_type: targetModule,
        },
      })
      useAgentStore.getState().markSessionPending(conversationId)
      setAgentPanelCollapsed(false)
      setActiveStage(MODULE_META[targetModule].stage)
      wsClient.send({
        type: 'message',
        content: prompt,
        session_id: projectId,
        user_id: 'ui_user',
        loop_mode: 'project',
        stream: streamResponses,
        mode,
        agent_profile: agentProfile,
        workflow_run_id: runId,
        workflow_module_type: targetModule,
      })
      setTargetModule(null)
      setDeliveryFormat(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={controlsRef} className={`${interactionVisible ? 'min-h-0 flex-[1_1_100%]' : 'max-h-[45vh] shrink-0'} overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-6 ${candidateListCollapsed ? 'py-2' : 'py-4'}`}>
      <div className="mx-auto max-w-2xl">
        {interactionVisible && (
          <div className="mb-4">
            <WorkflowInteractionPanel
              key={String((selectedRun.module_data.interaction as { interaction_id?: unknown }).interaction_id ?? selectedRun.run_id)}
              projectId={projectId}
              run={selectedRun}
            />
          </div>
        )}
        {snapshot && moduleCandidates.length > 0 && (
          <div className={candidateListCollapsed ? (interactionVisible ? 'mb-2' : '') : 'mb-4'}>
            <div className={`flex flex-wrap items-center justify-between gap-3 ${candidateListCollapsed ? '' : 'mb-2'}`}>
              <div className="flex min-w-0 items-center gap-2">
                <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {lang === 'zh' ? '本模块候选交付物' : 'Candidate outputs in this module'}
                </div>
                {candidateListCollapsed && (
                  <div className="truncate text-[10px] text-[var(--color-text-muted)]">
                    {lang === 'zh'
                      ? `${moduleCandidates.length} 个候选${selectedCandidate ? ` · 已选择：${selectedCandidate.label}` : ''}`
                      : `${moduleCandidates.length} candidate${moduleCandidates.length === 1 ? '' : 's'}${selectedCandidate ? ` · Selected: ${selectedCandidate.label}` : ''}`}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!candidateListCollapsed && (
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {lang === 'zh' ? '与项目总览同步' : 'Synced with project overview'}
                  </div>
                )}
                <button
                  type="button"
                  aria-expanded={!candidateListCollapsed}
                  aria-controls="module-candidate-output-list"
                  aria-label={lang === 'zh'
                    ? (candidateListCollapsed ? '展开候选交付物' : '折叠候选交付物')
                    : (candidateListCollapsed ? 'Expand candidate outputs' : 'Collapse candidate outputs')}
                  title={lang === 'zh'
                    ? (candidateListCollapsed ? '展开' : '折叠')
                    : (candidateListCollapsed ? 'Expand' : 'Collapse')}
                  onClick={() => setCandidateListCollapsed((collapsed) => !collapsed)}
                  className="flex h-6 items-center gap-1 rounded-md border border-[var(--color-border)] px-1.5 text-[10px] font-bold text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className={`h-3 w-3 transition-transform ${candidateListCollapsed ? '-rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                  {lang === 'zh'
                    ? (candidateListCollapsed ? '展开' : '收起')
                    : (candidateListCollapsed ? 'Expand' : 'Collapse')}
                </button>
              </div>
            </div>
            <div id="module-candidate-output-list" hidden={candidateListCollapsed}>
              <WorkflowCandidateList
                projectId={projectId}
                moduleType={selectedRun.module_type}
                runs={snapshot.runs}
                compact
              />
            </div>
          </div>
        )}

        {selectedRun.status === 'completed' && downstream.length > 0 && (
          <div className={interactionVisible || candidateListCollapsed ? 'mt-4' : ''}>
            <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
              {lang === 'zh' ? '下一步：从当前结果继续' : 'Next: continue from this result'}
            </div>
            {mustSelectCandidate && (
              <div className="mb-2 text-[10px] text-amber-600">
                {lang === 'zh'
                  ? (candidateListCollapsed ? '请展开上方候选列表，选择一个 item。' : '请先从上方候选列表选择一个 item。')
                  : (candidateListCollapsed ? 'Expand the candidate list above and select one item first.' : 'Select one item from the candidate list above first.')}
              </div>
            )}
            {selectedExperimentIncomplete && (
              <div className="mb-2 text-[10px] text-amber-600">
                {lang === 'zh' ? '该实验未完成，不能作为已完成结果继续交付。' : 'This experiment is not completed and cannot be handed off as a completed result.'}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {downstream.map((moduleType) => (
                <button
                  key={moduleType}
                  type="button"
                  disabled={mustSelectCandidate || selectedExperimentIncomplete}
                  onClick={() => openTarget(moduleType)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {lang === 'zh'
                    ? `用此候选继续${MODULE_META[moduleType].zh} →`
                    : `Continue to ${MODULE_META[moduleType].en} →`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {targetModule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="downstream-module-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{MODULE_META[targetModule].icon}</span>
              <div className="min-w-0 flex-1">
                <h3 id="downstream-module-title" className="text-base font-semibold text-[var(--color-text-primary)]">
                  {lang === 'zh'
                    ? `继续到${MODULE_META[targetModule].zh}`
                    : `Continue to ${MODULE_META[targetModule].en}`}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {lang === 'zh'
                    ? `将继承当前 Run 的 ${selectedRun.outputs.length} 个产物，并创建新的分支。`
                    : `Creates a new branch with ${selectedRun.outputs.length} inherited artifact(s).`}
                </p>
              </div>
              <button
                type="button"
                aria-label={lang === 'zh' ? '关闭' : 'Close'}
                onClick={closeDialog}
                disabled={pending}
                className="rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
              >
                ×
              </button>
            </div>

            <label className="mt-5 block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="downstream-run-intent">
              {lang === 'zh' ? '本次运行目标' : 'Goal for this run'}
            </label>
            <textarea
              id="downstream-run-intent"
              value={intent}
              disabled={pending}
              onChange={(event) => setIntent(event.target.value)}
              className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />

            {targetModule === 'experiment' && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <ExperimentExecutionMode value={experimentMode} onChange={setExperimentMode} disabled={pending} />
                  <ExperimentContractMode value={experimentContractVersion} onChange={setExperimentContractVersion} disabled={pending} />
                </div>
                <ExperimentInputPaths paths={inputPaths} onChange={setInputPaths} onValidChange={setInputPathsValid} disabled={pending} />
              </>
            )}

            {targetModule === 'delivery' && (
              <fieldset className="mt-4">
                <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {lang === 'zh' ? '选择交付物形式' : 'Choose deliverable format'}
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {DELIVERY_FORMATS.map((option) => {
                    const config = getExportConfig(option.format)
                    const active = deliveryFormat === option.format
                    return (
                      <button
                        key={option.format}
                        type="button"
                        aria-pressed={active}
                        disabled={pending}
                        onClick={() => {
                          setDeliveryFormat(option.format)
                          setError(null)
                        }}
                        className={[
                          'rounded-xl border p-3 text-left',
                          active
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-hover)]',
                        ].join(' ')}
                      >
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {option.icon} {t(option.labelKey, lang)}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                          {config.outputPath}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {deliveryFormat === 'paper_article' && <JournalTargetSelect value={targetJournal} onChange={setTargetJournal} disabled={pending} />}
              </fieldset>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={closeDialog}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={pending || !intent.trim() || (targetModule === 'experiment' && !inputPathsValid) || (targetModule === 'delivery' && !deliveryFormat)}
                onClick={() => void startDownstreamRun()}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending
                  ? (lang === 'zh' ? '正在启动…' : 'Starting…')
                  : (lang === 'zh' ? '创建分支并开始' : 'Create branch and start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
