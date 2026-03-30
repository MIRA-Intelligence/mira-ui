import { useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'
import { uploadProjectFiles } from '@/services/api'
import { cn } from '@/lib/utils'
import type { OutputGoal, NewProjectInput } from '@/types'

const OUTPUT_GOALS: { value: OutputGoal; label: string; icon: string }[] = [
  { value: 'paper', label: 'Paper', icon: '📄' },
  { value: 'report', label: 'Report', icon: '📊' },
  { value: 'analysis', label: 'Analysis', icon: '🔬' },
  { value: 'code', label: 'Code', icon: '💻' },
]

const DOMAIN_SUGGESTIONS = [
  'Medical Imaging',
  'NLP',
  'Computer Vision',
  'Reinforcement Learning',
  'Drug Discovery',
  'Genomics',
  'Signal Processing',
  'Robotics',
]

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

function buildAgentMessage(
  input: NewProjectInput,
  workspacePath: string,
  projectId: string,
  uploadedPaths: string[],
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

  if (uploadedPaths.length > 0) {
    lines.push('', `## Uploaded Data Files`)
    for (const path of uploadedPaths) {
      lines.push(`- ${path}`)
    }
    lines.push('', `These files are saved under ${workspacePath}/${projectId}/data.`)
  }
  if (input.domain) {
    lines.push('', `**Domain**: ${input.domain}`)
  }
  if (input.references) {
    lines.push('', `## References`, input.references)
  }
  if (input.computeBudget) {
    lines.push('', `**Compute Budget**: ${input.computeBudget}`)
  }
  lines.push('', `**Output Goal**: ${input.outputGoal}`)
  lines.push(
    '',
    `Please begin by creating a task_plan.json, then start with the **Research** phase: search for relevant literature, add references and notes to the research section of task_plan.json. After completing the research survey, STOP and report your findings.`,
  )

  return lines.join('\n')
}

export function NewProjectModal() {
  const { newProjectOpen, closeNewProject } = useUiStore()
  const { createProject, deleteTask, projectsLoaded } = useProjectStore()
  const connected = useAgentStore((s) => s.connected)
  const { workspacePath } = useSettingsStore()

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [description, setDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [creating, setCreating] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [title, setTitle] = useState('')
  const [domain, setDomain] = useState('')
  const [references, setReferences] = useState('')
  const [computeBudget, setComputeBudget] = useState('')
  const [outputGoal, setOutputGoal] = useState<OutputGoal>('paper')
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (!newProjectOpen) return null

  const canCreate = description.trim().length > 0 && connected && projectsLoaded && !creating

  const handleFilesAdded = (files: FileList | File[]) => {
    setSelectedFiles((prev) => mergeSelectedFiles(prev, files))
    setUploadError('')
  }

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleBrowse = () => {
    fileInputRef.current?.click()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) {
      handleFilesAdded(e.dataTransfer.files)
    }
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    setUploadError('')

    const input: NewProjectInput = {
      description: description.trim(),
      title: title.trim() || undefined,
      domain: domain.trim() || undefined,
      references: references.trim() || undefined,
      computeBudget: computeBudget.trim() || undefined,
      outputGoal,
    }

    const projectId = createProject(input)
    let uploadedPaths: string[] = []

    try {
      const uploaded = await uploadProjectFiles(projectId, selectedFiles)
      uploadedPaths = uploaded.map((file) => file.path)
    } catch (err) {
      await deleteTask(projectId, false)
      setUploadError(err instanceof Error ? err.message : 'Failed to upload data files.')
      setCreating(false)
      return
    }

    const agentMsg = buildAgentMessage(input, workspacePath, projectId, uploadedPaths)
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
    })

    // Reset form
    setDescription('')
    setSelectedFiles([])
    setTitle('')
    setDomain('')
    setReferences('')
    setComputeBudget('')
    setOutputGoal('paper')
    setShowAdvanced(false)
    setCreating(false)
    setUploadError('')
    closeNewProject()
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeNewProject()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)]"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-[560px] max-h-[85vh] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">New Research Project</h2>
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
              Research Description
              <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your research goal, question, or hypothesis..."
              rows={4}
              className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-none leading-relaxed"
            />
          </div>

          {/* Data Source */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Data Source Files
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-input-bg)] px-3 py-2.5"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFilesAdded(e.target.files)
                  e.currentTarget.value = ''
                }}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-text-muted)]">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} file(s) selected`
                    : 'Drag files here or click Browse to upload into data/'}
                </p>
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
                >
                  Browse
                </button>
              </div>
              {selectedFiles.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                  {selectedFiles.map((file, idx) => (
                    <div key={`${file.name}-${file.lastModified}-${idx}`} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(idx)}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {uploadError && (
              <p className="text-[11px] text-[var(--color-error)]">{uploadError}</p>
            )}
          </div>

          {/* Output Goal */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Output Goal
            </label>
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
                  {g.label}
                </button>
              ))}
            </div>
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
            Advanced Options
          </button>

          {/* Advanced section */}
          <div className={cn(
            'space-y-4 overflow-hidden transition-all duration-200',
            showAdvanced ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0',
          )}>
            {/* Project Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Project Title
                <span className="ml-1 text-[var(--color-text-muted)] font-normal">— leave empty for AI to generate</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Prefix-Ratio GRPO for High-Staleness Rollout Replay"
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
              />
            </div>

            {/* Research Domain */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Research Domain
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DOMAIN_SUGGESTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDomain(domain === d ? '' : d)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs transition-colors',
                      domain === d
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="Or type a custom domain..."
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
              />
            </div>

            {/* References */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                References
              </label>
              <textarea
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                placeholder="Paper DOIs, file paths, or URLs (one per line)..."
                rows={2}
                className="w-full bg-[var(--color-input-bg)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-none"
              />
            </div>

            {/* Compute Budget */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Compute Budget
              </label>
              <input
                value={computeBudget}
                onChange={(e) => setComputeBudget(e.target.value)}
                placeholder="e.g. 100 GPU hours, $50 max..."
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
            Cancel
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
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
        {!connected && (
          <p className="text-[11px] text-[var(--color-error)] text-center mt-2">
            Agent is disconnected — connect first to create a project.
          </p>
        )}
      </div>
    </div>
  )
}
