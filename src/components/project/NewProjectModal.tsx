import { useCallback, useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'
import { uploadProjectFiles, validateDataPath } from '@/services/api'
import { fetchRuntimeConfig } from '@/services/runtimeConfig'
import { cn } from '@/lib/utils'
import type {
  AgentProfile,
  AutomationGoal,
  AutomationGoalLogic,
  AutomationGoalOperator,
  ContractVersion,
  LiteratureSource,
  NewProjectInput,
} from '@/types'
import { t } from '@/i18n'

const GOAL_OPERATORS: AutomationGoalOperator[] = ['>', '>=', '<', '<=', '==']
const DEFAULT_GOAL: AutomationGoal = { metric: '', operator: '>', value: Number.NaN }
const PROFILE_OPTIONS: Array<{ key: AgentProfile; labelKey: 'engineerMode' | 'researchMode' }> = [
  { key: 'engineer', labelKey: 'engineerMode' },
  { key: 'research', labelKey: 'researchMode' },
]
const CONTRACT_OPTIONS: Array<{ key: ContractVersion; labelKey: 'contractCompat' | 'contractStrict' }> = [
  { key: 1, labelKey: 'contractCompat' },
  { key: 2, labelKey: 'contractStrict' },
]
const LITERATURE_SOURCE_OPTIONS: Array<{ key: LiteratureSource; label: string }> = [
  { key: 'pubmed', label: 'PubMed' },
  { key: 'google_scholar', label: 'Google Scholar' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'semantic_scholar', label: 'Semantic Scholar' },
  { key: 'crossref', label: 'Crossref' },
  { key: 'europe_pmc', label: 'Europe PMC' },
]
const DEFAULT_LITERATURE_SOURCES: LiteratureSource[] = LITERATURE_SOURCE_OPTIONS.map((item) => item.key)
const LITERATURE_SOURCE_INSTRUCTIONS: Record<LiteratureSource, string> = {
  pubmed: 'PubMed: use pubmed-search / NCBI PubMed for biomedical and clinical papers.',
  google_scholar: 'Google Scholar: use multi-search-engine or agent-browser against scholar.google.com when accessible; fall back to general web search if blocked.',
  arxiv: 'arXiv: use arxiv.org search/API/MCP if configured, or site:arxiv.org queries for preprints.',
  semantic_scholar: 'Semantic Scholar: use semanticscholar.org search or available API/web search for citation graph and related papers.',
  crossref: 'Crossref: use crossref.org metadata search for DOI, venue, and citation metadata.',
  europe_pmc: 'Europe PMC: use europepmc.org for biomedical full-text and preprint coverage.',
}

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

function detectPreferredReplyLanguage(text: string): 'zh' | 'en' {
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  if (hanCount === 0 && latinCount === 0) return 'en'
  if (hanCount > 0 && hanCount * 2 >= latinCount) return 'zh'
  return 'en'
}

function buildAgentMessage(
  input: NewProjectInput,
  workspacePath: string,
  projectId: string,
  uploadedDataPaths: string[],
  uploadedReferencePaths: string[],
  runMode: 'manual' | 'auto',
): string {
  const preferredLanguage = detectPreferredReplyLanguage([
    input.description,
    input.references ?? '',
  ].join('\n'))
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

  const literatureReview = input.literatureReview ?? {
    enabled: true,
    sources: DEFAULT_LITERATURE_SOURCES,
  }
  const selectedLiteratureSources = literatureReview.sources.length > 0
    ? literatureReview.sources
    : DEFAULT_LITERATURE_SOURCES
  const selectedSourceLabels = selectedLiteratureSources
    .map((source) => LITERATURE_SOURCE_OPTIONS.find((item) => item.key === source)?.label ?? source)

  const referenceInstruction = literatureReview.enabled
    ? uploadedReferencePaths.length > 0
      ? `Before external search, first read and synthesize local materials under ${workspacePath}/${projectId}/references. Then search only these external literature sources: ${selectedSourceLabels.join(', ')}.`
      : `Search these external literature sources and synthesize reliable references: ${selectedSourceLabels.join(', ')}.`
    : uploadedReferencePaths.length > 0 || input.references
      ? 'Literature research is disabled. Do not search external literature libraries. Only use uploaded/provided references if they are directly needed.'
      : 'Literature research is disabled. Do not run external literature search or spend a separate literature-review stage.'
  const languageInstruction = preferredLanguage === 'zh'
    ? 'Language policy: The user input is primarily Chinese. Respond in Chinese for progress updates, experiment summaries, and final replies unless the user explicitly asks for another language.'
    : 'Language policy: The user input is primarily English. Respond in English unless the user explicitly asks for another language.'

  lines.push('', '## Literature Research Policy')
  if (literatureReview.enabled) {
    lines.push(
      `Enabled: yes`,
      `Selected sources: ${selectedSourceLabels.join(', ')}`,
      'Use only the selected external sources for the literature survey unless the user explicitly asks for more.',
      'For each accepted paper, write title, authors, year, venue/source, URL/DOI, short summary, and relevance into task_plan.json research.references.',
      'Record conflicting evidence and gaps in task_plan.json research.notes or research.survey.',
      'Source-specific guidance:',
    )
    for (const source of selectedLiteratureSources) {
      lines.push(`- ${LITERATURE_SOURCE_INSTRUCTIONS[source]}`)
    }
  } else {
    lines.push(
      'Enabled: no',
      'Skip external literature search. Keep task_plan.json research.references empty unless user-provided references or uploaded PDFs/ZIPs are used.',
      'Move directly to project planning and experiments after creating task_plan.json.',
    )
  }

  lines.push(
    '',
    literatureReview.enabled
      ? `Please begin by creating a task_plan.json, then start with the **Research** phase. ${referenceInstruction} Add references and notes to task_plan.json research section. ${modeInstruction} ${languageInstruction}`
      : `Please begin by creating a task_plan.json. ${referenceInstruction} Do not perform a Research & Literature survey unless explicitly requested later. ${runMode === 'manual' ? 'After planning the first actionable experiment, STOP and report the plan.' : 'Continue automatically into the first pending experiment until stop conditions are met.'} ${languageInstruction}`,
  )

  return lines.join('\n')
}

type PathCheckState = {
  status: 'idle' | 'testing' | 'success' | 'error'
  message: string
}

type DataSourceMode = 'serverPath' | 'upload'

function getFileDisplayPath(file: File): string {
  const relativePath = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : ''
  return relativePath || file.name
}

export function NewProjectModal() {
  const { newProjectOpen, closeNewProject, newProjectPrefill, newProjectFromChatId } = useUiStore()
  const removeChat = useChatStore((s) => s.removeChat)
  const {
    tasks,
    selectedTaskId,
    createProject,
    deleteTask,
    projectsLoaded,
    agentProfile,
    contractVersion,
    setAgentProfile,
    setContractVersion,
  } = useProjectStore()
  const connected = useAgentStore((s) => s.connected)
  // Block runtime switching while ANY session is mid-stream, not just one.
  const isStreaming = useAgentStore((s) => Object.values(s.streamingBySession).some(Boolean))
  const { workspacePath, language: lang, deploymentMode } = useSettingsStore()
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)
  const hasRunningExperiment = !!selectedTask?.experiments.some((exp) => exp.status === 'running')
  const canSwitchRuntime = !isStreaming && !hasRunningExperiment

  const dataFileInputRef = useRef<HTMLInputElement | null>(null)
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const pathCheckSeqRef = useRef(0)
  const pathCheckTimerRef = useRef<number | null>(null)
  const [description, setDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedReferenceFiles, setSelectedReferenceFiles] = useState<File[]>([])
  const [serverDataPath, setServerDataPath] = useState('')
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('serverPath')
  const [pathCheck, setPathCheck] = useState<PathCheckState>({ status: 'idle', message: '' })
  const [creating, setCreating] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [title, setTitle] = useState('')
  const [references, setReferences] = useState('')
  const [computeBudget, setComputeBudget] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [literatureResearchEnabled, setLiteratureResearchEnabled] = useState(true)
  const [selectedLiteratureSources, setSelectedLiteratureSources] = useState<LiteratureSource[]>(DEFAULT_LITERATURE_SOURCES)
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

  useEffect(() => {
    return () => clearPathCheckTimer()
  }, [])

  const setFolderInputRef = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node
    if (!node) return
    node.setAttribute('webkitdirectory', '')
    node.setAttribute('directory', '')
  }, [])

  // Seed the description when opened with a prefill (e.g. promoting a Quick
  // Chat into a project). Only fill an empty field so we never clobber edits.
  useEffect(() => {
    if (newProjectOpen && newProjectPrefill && !description.trim()) {
      setDescription(newProjectPrefill)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newProjectOpen, newProjectPrefill])

  if (!newProjectOpen) return null

  const handleDataFilesAdded = (files: FileList | File[]) => {
    const incomingFiles = Array.from(files)
    if (incomingFiles.length === 0) return
    setDataSourceMode('upload')
    setSelectedFiles((prev) => mergeSelectedFiles(prev, incomingFiles))
    setServerDataPath('')
    clearPathCheckTimer()
    setPathCheck({ status: 'idle', message: '' })
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

  const useNativePathPicker = deploymentMode === 'localBundle' && Boolean(window.electronAPI?.selectDataPath)
  const allowDataUpload = deploymentMode === 'remoteManual'
  const dataPathPlaceholderKey = deploymentMode === 'localBundle'
    ? 'localDataPathPlaceholder'
    : 'remoteDataPathPlaceholder'

  const applySelectedServerPath = (path: string) => {
    setDataSourceMode('serverPath')
    setServerDataPath(path)
    setSelectedFiles([])
    setUploadError('')
    void runPathValidation(path)
  }

  const handleDataBrowse = () => {
    if (useNativePathPicker) {
      void window.electronAPI?.selectDataPath?.('file').then((path) => {
        if (path) applySelectedServerPath(path)
      })
      return
    }
    if (!allowDataUpload) return
    dataFileInputRef.current?.click()
  }

  const handleReferencesBrowse = () => {
    referenceFileInputRef.current?.click()
  }

  const handleBrowseFolder = () => {
    if (useNativePathPicker) {
      void window.electronAPI?.selectDataPath?.('directory').then((path) => {
        if (path) applySelectedServerPath(path)
      })
      return
    }
    if (!allowDataUpload) return
    folderInputRef.current?.click()
  }

  const handleDataDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (allowDataUpload && e.dataTransfer.files?.length) {
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

  const toggleLiteratureSource = (source: LiteratureSource) => {
    setSelectedLiteratureSources((prev) => {
      if (prev.includes(source)) {
        return prev.length <= 1 ? prev : prev.filter((item) => item !== source)
      }
      return [...prev, source]
    })
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
      literatureReview: {
        enabled: literatureResearchEnabled,
        sources: selectedLiteratureSources,
      },
      agentProfile,
      contractVersion,
      automationPolicy,
    }

    try {
      let effectiveWorkspacePath = workspacePath.trim()
      if (deploymentMode === 'remoteManual') {
        const payload = await fetchRuntimeConfig()
        const settingsStore = useSettingsStore.getState()
        effectiveWorkspacePath = payload.runtime.workspace || payload.projects_root
        settingsStore.setRuntimeConfig(payload)
        settingsStore.setRuntimeConfigLoaded(true)
        settingsStore.setRuntimeConfigError(null)
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

      const {
        mode,
        agentProfile: runtimeProfile,
        contractVersion: runtimeContractVersion,
      } = useProjectStore.getState()
      const agentMsg = buildAgentMessage(
        input,
        effectiveWorkspacePath,
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
        loop_mode: 'project',
        stream: useSettingsStore.getState().streamResponses,
        mode,
        agent_profile: runtimeProfile,
        contract_version: runtimeContractVersion,
        automation_policy: input.automationPolicy,
      })

      // Promoted from a Quick Chat: drop the now-superseded chat thread.
      if (newProjectFromChatId) {
        removeChat(newProjectFromChatId)
      }

      // Reset form
      setDescription('')
      setSelectedFiles([])
      setSelectedReferenceFiles([])
      setServerDataPath('')
      setDataSourceMode('serverPath')
      setPathCheck({ status: 'idle', message: '' })
      setTitle('')
      setReferences('')
      setComputeBudget('')
      setLiteratureResearchEnabled(true)
      setSelectedLiteratureSources(DEFAULT_LITERATURE_SOURCES)
      setGoalLogic('AND')
      setGoals([{ ...DEFAULT_GOAL }])
      setGoalValueInputs([''])
      setMaxExperiments('')
      setMaxTokens('')
      setShowAdvanced(false)
      setCreating(false)
      setUploadError('')
      closeNewProject()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('unknownError', lang))
      setCreating(false)
    }
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

          {/* Runtime Preferences */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('runtimePreferencesLabel', lang)}</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-[11px] text-[var(--color-text-muted)]">{t('profileLabel', lang)}</p>
                <div
                  className={cn(
                    'flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] p-0.5',
                    !canSwitchRuntime && 'opacity-60',
                  )}
                  title={!canSwitchRuntime ? t('profileSwitchManualOnly', lang) : undefined}
                >
                  {PROFILE_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      disabled={!canSwitchRuntime}
                      onClick={() => {
                        if (!canSwitchRuntime) return
                        setAgentProfile(item.key)
                      }}
                      className={cn(
                        'flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                        agentProfile === item.key
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                        !canSwitchRuntime && 'cursor-not-allowed',
                      )}
                    >
                      {t(item.labelKey, lang)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-[var(--color-text-muted)]">{t('contractModeLabel', lang)}</p>
                <div
                  className={cn(
                    'flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] p-0.5',
                    !canSwitchRuntime && 'opacity-60',
                  )}
                  title={!canSwitchRuntime ? t('contractSwitchManualOnly', lang) : undefined}
                >
                  {CONTRACT_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      disabled={!canSwitchRuntime}
                      onClick={() => {
                        if (!canSwitchRuntime) return
                        setContractVersion(item.key)
                      }}
                      className={cn(
                        'flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                        contractVersion === item.key
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                        !canSwitchRuntime && 'cursor-not-allowed',
                      )}
                    >
                      {t(item.labelKey, lang)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Data Source */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">{t('dataSourceFiles', lang)}</label>
            <div
              onDragOver={(e) => {
                if (allowDataUpload) e.preventDefault()
              }}
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
              <input
                ref={setFolderInputRef}
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
                    setDataSourceMode('serverPath')
                    if (selectedFiles.length > 0) setSelectedFiles([])
                    setUploadError('')
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
                  placeholder={t(dataPathPlaceholderKey, lang)}
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
                {(useNativePathPicker || allowDataUpload) && (
                  <>
                    <button
                      type="button"
                      onClick={handleDataBrowse}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
                    >
                      {useNativePathPicker ? t('browseFilePath', lang) : t('browseUploadFiles', lang)}
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowseFolder}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
                    >
                      {useNativePathPicker ? t('browseFolderPath', lang) : t('browseUploadFolder', lang)}
                    </button>
                  </>
                )}
              </div>
              {allowDataUpload && (
                <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
                  {t('remoteDataSourceHint', lang)}
                </p>
              )}
              {selectedFiles.length > 0 && dataSourceMode === 'upload' && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  {t('filesSelectedForUpload', lang, { count: selectedFiles.length })}
                </p>
              )}
              {selectedFiles.length > 0 && dataSourceMode === 'upload' && (
                <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                  {selectedFiles.map((file, idx) => (
                    <div key={`${getFileDisplayPath(file)}-${file.lastModified}-${idx}`} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="truncate">{getFileDisplayPath(file)}</span>
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

            {/* Literature Research */}
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] p-3">
              <label className="flex items-start gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={literatureResearchEnabled}
                  onChange={(e) => setLiteratureResearchEnabled(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span>
                  {t('literatureResearchLabel', lang)}
                  <span className="block mt-0.5 text-[11px] font-normal text-[var(--color-text-muted)]">
                    {t('literatureResearchHint', lang)}
                  </span>
                </span>
              </label>

              <div className={cn(
                'grid grid-cols-2 gap-2 transition-opacity',
                !literatureResearchEnabled && 'opacity-50',
              )}>
                {LITERATURE_SOURCE_OPTIONS.map((source) => (
                  <label
                    key={source.key}
                    className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLiteratureSources.includes(source.key)}
                      disabled={!literatureResearchEnabled}
                      onChange={() => toggleLiteratureSource(source.key)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span>{source.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {literatureResearchEnabled
                  ? t('literatureSourcesDefaultHint', lang)
                  : t('literatureDisabledHint', lang)}
              </p>
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
