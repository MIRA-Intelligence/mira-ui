import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'
import { uploadProjectFiles, validateDataPath } from '@/services/api'
import { cn } from '@/lib/utils'
import type {
  AutomationGoal,
  AutomationGoalLogic,
  AutomationGoalOperator,
  OutputGoal,
  NewProjectInput,
} from '@/types'
import { t } from '@/i18n'

const OUTPUT_GOALS: { value: OutputGoal; label: string; icon: string }[] = [
  { value: 'paper', label: 'Paper', icon: '📄' },
  { value: 'report', label: 'Report', icon: '📊' },
  { value: 'analysis', label: 'Analysis', icon: '🔬' },
  { value: 'code', label: 'Code', icon: '💻' },
]

const GOAL_OPERATORS: AutomationGoalOperator[] = ['>', '>=', '<', '<=', '==']
const DEFAULT_GOAL: AutomationGoal = { metric: '', operator: '>', value: Number.NaN }

function mergeSelectedFiles(existing: File[], incoming: FileList | File[]): File[] {
  const next = [...existing]
  const incomingList = Array.from(incoming)
  for (const file of incomingList) {
    const duplicated = next.some(
      (it) => it.name === file.name && it.size === file.size && it.lastModified === file.lastModified,
    )
    if (!duplicated) next.push(file)
  }
  return next
}

function parsePositiveInt(raw: string): number | undefined {
  const value = Number(raw.trim())
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function isReferenceFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.pdf') || name.endsWith('.zip')
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

function buildAgentMessage(
  input: NewProjectInput,
  workspacePath: string,
  projectId: string,
  uploadedDataPaths: string[],
  uploadedReferencePaths: string[],
  runMode: 'manual' | 'auto',
): string {
  const lines = [
    `New research project initialized.`,
    ``,
    `**Project ID**: ${projectId}`,
    `**Workspace**: ${workspacePath}/${projectId}`,
    ``,
    `## Research Description`,
    input.description,
  ]

  if (uploadedDataPaths.length > 0) {
    lines.push('', `## Uploaded Data Files`)
    for (const path of uploadedDataPaths) {
      lines.push(`- ${path}`)
    }
    lines.push('', `These files are saved under ${workspacePath}/${projectId}/data.`)
  }

  if (uploadedReferencePaths.length > 0) {
    lines.push('', '## Uploaded Reference Materials')
    for (const path of uploadedReferencePaths) {
      lines.push(`- ${path}`)
    }
    lines.push(
      '',
      `These files are saved under ${workspacePath}/${projectId}/references.`,
      'Prioritize reading and analyzing these reference materials before external literature search.',
    )
  }

  if (input.references) {
    lines.push('', `## References`, input.references)
  }
  if (input.computeBudget) {
    lines.push('', `**Compute Budget**: ${input.computeBudget}`)
  }
  if (input.dataPath) {
    lines.push('', `## Server Data Path`, input.dataPath)
  }
  lines.push('', `**Output Goal**: ${input.outputGoal}`)

  if (input.automationPolicy) {
    lines.push('', '## Automation Policy', `Logic: ${input.automationPolicy.logic}`)
    if (input.automationPolicy.goals.length > 0) {
      lines.push('Goals:')
      for (const goal of input.automationPolicy.goals) {
        lines.push(`- ${goal.metric} ${goal.operator} ${goal.value}`)
      }
    }
    if (input.automationPolicy.maxExperiments) {
      lines.push(`- Max experiments: ${input.automationPolicy.maxExperiments}`)
    }
    if (input.automationPolicy.maxTokens) {
      lines.push(`- Max token budget: ${input.automationPolicy.maxTokens}`)
    }
  }

  const modeInstruction = runMode === 'manual'
    ? 'After completing the research survey, STOP and report your findings.'
    : 'After completing the research survey, continue automatically into the next pending experiment until stop conditions are met.'

  const referenceInstruction = uploadedReferencePaths.length > 0
    ? `Before external search, first read and synthesize local materials under ${workspacePath}/${projectId}/references.`
    : 'Search for relevant literature and synthesize reliable references.'

  lines.push(
    '',
    `Please begin by creating a task_plan.json, then start with the **Research** phase. ${referenceInstruction} Add references and notes to task_plan.json research section. ${modeInstruction}`,
  )

  return lines.join('\n')
}

type PathCheckState = {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
}

export function NewProjectModal() {
  const { newProjectOpen, closeNewProject } = useUiStore()
  const { createProject, deleteTask, projectsLoaded } = useProjectStore()
  const connected = useAgentStore((s) => s.connected)
  const { workspacePath, language: lang } = useSettingsStore()

  const dataFileInputRef = useRef<HTMLInputElement | null>(null)
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null)
  const pathCheckSeqRef = useRef(0)
  const pathCheckTimerRef = useRef<number | null>(null)
  const [description, setDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedReferenceFiles, setSelectedReferenceFiles] = useState<File[]>([])
  const [serverDataPath, setServerDataPath] = useState('')
  const [pathCheck, setPathCheck] = useState<PathCheckState>({ status: 'idle', message: '' })
  const [creating, setCreating] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [title, setTitle] = useState('')
  const [references, setReferences] = useState('')
  const [computeBudget, setComputeBudget] = useState('')
  const [outputGoal, setOutputGoal] = useState<OutputGoal>('paper')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [goalLogic, setGoalLogic] = useState<AutomationGoalLogic>('AND')
  const [goals, setGoals] = useState<AutomationGoal[]>([{ ...DEFAULT_GOAL }])
  const [goalValueInputs, setGoalValueInputs] = useState<string[]>([''])
  const [maxExperiments, setMaxExperiments] = useState('')
  const [maxTokens, setMaxTokens] = useState('')

  const canCreate = description.trim().length > 0 && connected && projectsLoaded && !creating

  const clearPathCheckTimer = () => {
    if (pathCheckTimerRef.current !== null) {
      window.clearTimeout(pathCheckTimerRef.current)
      pathCheckTimerRef.current = null
    }
  }

  const runPathValidation = async (rawPath: string) => {
    const value = rawPath.trim()
    if (!value) {
      setPathCheck({ status: 'idle', message: '' })
      return
    }
    const seq = ++pathCheckSeqRef.current
    setPathCheck({ status: 'testing', message: t('dataPathChecking', lang) })
    const result = await validateDataPath(value)
    if (seq !== pathCheckSeqRef.current) return
    if (result.ok) {
      const target = result.resolved_path || value
      const kind = result.kind === 'directory' ? t('directoryLabel', lang) : t('fileLabel', lang)
      setPathCheck({
        status: 'success',
        message: t('dataPathVisible', lang, { kind, path: target }),
      })
      return
    }
    setPathCheck({
      status: 'error',
      message: t('dataPathInvisible', lang, { reason: result.error || t('unknownError', lang) }),
    })
  }

  const schedulePathValidation = (value: string) => {
    clearPathCheckTimer()
    if (!value.trim()) {
      setPathCheck({ status: 'idle', message: '' })
      return
    }
    pathCheckTimerRef.current = window.setTimeout(() => {
      void runPathValidation(value)
    }, 500)
  }

  useEffect(() => () => clearPathCheckTimer(), [])

  if (!newProjectOpen) return null

  const handleDataFilesAdded = (files: FileList | File[]) => {
    setSelectedFiles((prev) => mergeSelectedFiles(prev, files))
    setUploadError('')
  }

  const handleReferenceFilesAdded = (files: FileList | File[]) => {
    const incomingList = Array.from(files)
    const validFiles = incomingList.filter((file) => isReferenceFile(file))
    if (validFiles.length !== incomingList.length) {
      setUploadError(t('referencesFileTypeHint', lang))
    } else {
      setUploadError('')
    }
    if (validFiles.length === 0) return
    setSelectedReferenceFiles((prev) => mergeSelectedFiles(prev, validFiles))
  }

  const removeSelectedDataFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const removeSelectedReferenceFile = (index: number) => {
    setSelectedReferenceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleDataBrowse = () => {
    dataFileInputRef.current?.click()
  }

  const handleReferencesBrowse = () => {
    referenceFileInputRef.current?.click()
  }

  const handleDataDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) {
      handleDataFilesAdded(e.dataTransfer.files)
    }
  }

  const handleReferencesDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) {
      handleReferenceFilesAdded(e.dataTransfer.files)
    }
  }

  const addGoal = () => {
    setGoals((prev) => [...prev, { ...DEFAULT_GOAL }])
    setGoalValueInputs((prev) => [...prev, ''])
  }

  const updateGoal = (index: number, patch: Partial<AutomationGoal>) => {
    setGoals((prev) => prev.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)))
  }

  const updateGoalValueInput = (index: number, raw: string) => {
    setGoalValueInputs((prev) => prev.map((value, i) => (i === index ? raw : value)))
    updateGoal(index, { value: raw.trim() === '' ? Number.NaN : Number(raw) })
  }

  const removeGoal = (index: number) => {
    setGoals((prev) => (
      prev.length <= 1
        ? [{ ...DEFAULT_GOAL }]
        : prev.filter((_, i) => i !== index)
    ))
    setGoalValueInputs((prev) => (
      prev.length <= 1
        ? ['']
        : prev.filter((_, i) => i !== index)
    ))
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    setUploadError('')

    const normalizedGoals = goals
      .map((goal, idx) => {
        const raw = (goalValueInputs[idx] ?? '').trim()
        const value = raw === '' ? Number.NaN : Number(raw)
        return {
        metric: goal.metric.trim(),
        operator: goal.operator,
        value,
      }
      })
      .filter((goal) => goal.metric.length > 0 && Number.isFinite(goal.value))

    const parsedMaxExperiments = parsePositiveInt(maxExperiments)
    const parsedMaxTokens = parsePositiveInt(maxTokens)
    const automationPolicy = (
      normalizedGoals.length > 0
      || parsedMaxExperiments !== undefined
      || parsedMaxTokens !== undefined
    )
      ? {
          logic: goalLogic,
          goals: normalizedGoals,
          maxExperiments: parsedMaxExperiments,
          maxTokens: parsedMaxTokens,
        }
      : undefined

    const input: NewProjectInput = {
      description: description.trim(),
      title: title.trim() || undefined,
      dataPath: serverDataPath.trim() || undefined,
      references: references.trim() || undefined,
      computeBudget: computeBudget.trim() || undefined,
      outputGoal,
      automationPolicy,
    }

    const projectId = await createProject(input)
    let uploadedDataPaths: string[] = []
    let uploadedReferencePaths: string[] = []

    try {
      const dataUpload = await uploadProjectFiles(projectId, selectedFiles, 'data')
      uploadedDataPaths = dataUpload.uploaded.map((file) => file.path)

      const referencesUpload = await uploadProjectFiles(projectId, selectedReferenceFiles, 'references')
      uploadedReferencePaths = dedupePaths([
        ...referencesUpload.uploaded.map((file) => file.path),
        ...referencesUpload.extracted.map((item) => item.path),
      ])
    } catch (err) {
      await deleteTask(projectId, false)
      setUploadError(err instanceof Error ? err.message : t('uploadDataFilesFailed', lang))
      setCreating(false)
      return
    }

    const { mode, agentProfile } = useProjectStore.getState()
    const agentMsg = buildAgentMessage(
      input,
      workspacePath,
      projectId,
      uploadedDataPaths,
      uploadedReferencePaths,
      mode,
    )
    useAgentStore.getState().addLog(projectId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: agentMsg,
      type: 'response',
      metadata: { _user: true },
    })
    wsClient.send({
      type: 'message',
      content: agentMsg,
      session_id: projectId,
      user_id: 'ui_user',
      mode,
      agent_profile: agentProfile,
      automation_policy: input.automationPolicy,
    })

    // Reset form
    setDescription('')
    setSelectedFiles([])
    setSelectedReferenceFiles([])
    setServerDataPath('')
    setPathCheck({ status: 'idle', message: '' })
    setTitle('')
    setReferences('')
    setComputeBudget('')
    setOutputGoal('paper')
    setGoalLogic('AND')
    setGoals([{ ...DEFAULT_GOAL }])
    setGoalValueInputs([''])
    setMaxExperiments('')
    setMaxTokens('')
    setShowAdvanced(false)
    setCreating(false)
    setUploadError('')
    closeNewProject()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)]"
    >
      <div className="w-full max-w-[560px] max-h-[85vh] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('newProject', lang)}</h2>
          <button
            onClick={closeNewProject}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Research Description — required */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1">
              {t('researchDescription', lang)}
              <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descPlaceholder', lang)}
              rows={4}
              className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-none leading-relaxed"
            />
          </div>

          {/* Data Source */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('dataSourceFiles', lang)}</label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDataDrop}
              className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-input-bg)] px-3 py-2.5"
            >
              <input
                ref={dataFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleDataFilesAdded(e.target.files)
                  e.currentTarget.value = ''
                }}
              />
              <div className="flex items-center gap-2">
                <input
                  value={serverDataPath}
                  onChange={(e) => {
                    setServerDataPath(e.target.value)
                    schedulePathValidation(e.target.value)
                  }}
                  onBlur={() => { void runPathValidation(serverDataPath) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void runPathValidation(serverDataPath)
                    }
                  }}
                  placeholder={t('dataPathPlaceholder', lang)}
                  className="flex-1 min-w-0 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
                />
                <span
                  aria-label={
                    pathCheck.status === 'success'
                      ? t('success', lang)
                      : pathCheck.status === 'error'
                        ? t('failed', lang)
                        : pathCheck.status === 'testing'
                          ? t('checking', lang)
                          : t('idle', lang)
                  }
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0 transition-all',
                    pathCheck.status === 'success' && 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]',
                    pathCheck.status === 'error' && 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.75)]',
                    pathCheck.status === 'testing' && 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]',
                    pathCheck.status === 'idle' && 'bg-[var(--color-text-muted)]/60 shadow-[0_0_4px_rgba(148,163,184,0.35)]',
                  )}
                />
                <button
                  type="button"
                  onClick={handleDataBrowse}
                  className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
                >
                  {t('browse', lang)}
                </button>
              </div>
              {selectedFiles.length > 0 && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  {t('filesSelected', lang, { count: selectedFiles.length })}
                </p>
              )}
              {selectedFiles.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                  {selectedFiles.map((file, idx) => (
                    <div key={`${file.name}-${file.lastModified}-${idx}`} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedDataFile(idx)}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        {t('remove', lang)}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {pathCheck.message && (
                <p
                  className={cn(
                    'mt-1.5 text-[11px]',
                    pathCheck.status === 'success' && 'text-emerald-400',
                    pathCheck.status === 'error' && 'text-red-400',
                    pathCheck.status === 'testing' && 'text-amber-400',
                    pathCheck.status === 'idle' && 'text-[var(--color-text-muted)]',
                  )}
                >
                  {pathCheck.message}
                </p>
              )}
            </div>
            {uploadError && (
              <p className="text-[11px] text-[var(--color-error)]">{uploadError}</p>
            )}
          </div>

          {/* Output Goal */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('outputGoal', lang)}</label>
            <div className="flex gap-2">
              {OUTPUT_GOALS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setOutputGoal(g.value)}
                  className={cn(
                    'flex-1 py-2 rounded-lg border text-xs font-medium transition-colors',
                    outputGoal === g.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  <span className="block text-base mb-0.5">{g.icon}</span>
                  {t(g.value, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* Automation Policy */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('autoStopPolicyLabel', lang)}</label>
            <div className="flex gap-2">
              {(['AND', 'OR'] as AutomationGoalLogic[]).map((logic) => (
                <button
                  key={logic}
                  type="button"
                  onClick={() => setGoalLogic(logic)}
                  className={cn(
                    'px-3 py-1 rounded-lg border text-xs font-medium transition-colors',
                    goalLogic === logic
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {logic}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {goals.map((goal, idx) => (
                <div key={`goal-${idx}`} className="grid grid-cols-[1fr_auto_120px_auto] gap-2 items-center">
                  <input
                    value={goal.metric}
                    onChange={(e) => updateGoal(idx, { metric: e.target.value })}
                    placeholder={t('goalMetricPlaceholder', lang)}
                    className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <select
                    value={goal.operator}
                    onChange={(e) => updateGoal(idx, { operator: e.target.value as AutomationGoalOperator })}
                    className="bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-xs rounded-lg px-2 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {GOAL_OPERATORS.map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                  <input
                    value={goalValueInputs[idx] ?? ''}
                    onChange={(e) => updateGoalValueInput(idx, e.target.value)}
                    placeholder={t('goalValuePlaceholder', lang)}
                    className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeGoal(idx)}
                    className="px-2 py-1 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {t('remove', lang)}
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addGoal}
              className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {t('addGoalButton', lang)}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={maxExperiments}
                onChange={(e) => setMaxExperiments(e.target.value)}
                placeholder={t('maxExperimentsPlaceholder', lang)}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
              />
              <input
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder={t('maxTokensPlaceholder', lang)}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)]">{t('autoStopPolicyHint', lang)}</p>
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={cn('transition-transform', showAdvanced && 'rotate-90')}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {t('advancedOptions', lang)}
          </button>

          {/* Advanced section */}
          <div className={cn(
            'space-y-4 overflow-hidden transition-all duration-200',
            showAdvanced ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0',
          )}>
            {/* Project Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                {t('projectTitle', lang)}
                <span className="ml-1 text-[var(--color-text-muted)] font-normal">{t('titleHint', lang)}</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder', lang)}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
              />
            </div>

            {/* References */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('referencesLabel', lang)}</label>
              <textarea
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                placeholder={t('referencesPlaceholder', lang)}
                rows={2}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-none"
              />
            </div>

            {/* References Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('referenceFilesLabel', lang)}</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleReferencesDrop}
                className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-input-bg)] px-3 py-2.5"
              >
                <input
                  ref={referenceFileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleReferenceFilesAdded(e.target.files)
                    e.currentTarget.value = ''
                  }}
                />
                <div className="flex items-center gap-2">
                  <p className="flex-1 min-w-0 text-xs text-[var(--color-text-muted)]">{t('referenceFilesHint', lang)}</p>
                  <button
                    type="button"
                    onClick={handleReferencesBrowse}
                    className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
                  >
                    {t('browse', lang)}
                  </button>
                </div>
                {selectedReferenceFiles.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {t('filesSelected', lang, { count: selectedReferenceFiles.length })}
                  </p>
                )}
                {selectedReferenceFiles.length > 0 && (
                  <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                    {selectedReferenceFiles.map((file, idx) => (
                      <div key={`${file.name}-${file.lastModified}-${idx}`} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedReferenceFile(idx)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                          {t('remove', lang)}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">{t('referencesFileTypeHint', lang)}</p>
              </div>
            </div>

            {/* Compute Budget */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('computeBudgetLabel', lang)}</label>
              <input
                value={computeBudget}
                onChange={(e) => setComputeBudget(e.target.value)}
                placeholder={t('computeBudgetPlaceholder', lang)}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
              />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          <button
            onClick={closeNewProject}
            className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {t('cancel', lang)}
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium transition-colors',
              canCreate
                ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/80'
                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] cursor-not-allowed',
            )}
          >
            {creating ? t('creating', lang) : t('createProject', lang)}
          </button>
        </div>
        {!connected && (
          <p className="text-[11px] text-[var(--color-error)] text-center mt-2">
            {t('agentDisconnectedCreateProject', lang)}
          </p>
        )}
      </div>
    </div>
  )
}
