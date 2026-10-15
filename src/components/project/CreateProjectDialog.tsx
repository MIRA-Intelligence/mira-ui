import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore, type Language } from '@/stores/settingsStore'
import { useUiStore, type PromotionRequest } from '@/stores/uiStore'
import { useAgentStore } from '@/stores/agentStore'
import { useChatStore } from '@/stores/chatStore'
import { joinProjectPath, slugifyProjectId } from '@/lib/projectPaths'
import { t } from '@/i18n'
import { attachChatContext, ProjectDirectoryExistsError } from '@/services/api'
import { PIPELINE_STAGES } from '@/components/workflow/PipelineOverview'

function promotedIntent(path: string, lang: Language): string {
  return lang === 'zh'
    ? `基于快速对话继续：对话上下文已保存在 \`${path}\`，请先阅读并据此确定本次运行目标。`
    : `Continue from the Quick Chat: the conversation is saved at \`${path}\`. Read it first and derive this run's goal from it.`
}

export function CreateProjectDialog({ onClose, promotion }: {
  onClose: () => void
  // Quick Chat promotion: attach the conversation, then open this workflow's start dialog.
  promotion?: PromotionRequest
}) {
  const { language: lang, workspacePath, runtimeConfig, deploymentMode } = useSettingsStore()
  const createProjectShell = useProjectStore((s) => s.createProjectShell)
  const location = runtimeConfig?.project_location
  const customDirAllowed = location?.custom_dir_allowed ?? true
  const defaultParent = location?.default_parent_dir || runtimeConfig?.projects_root || workspacePath
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [existingDir, setExistingDir] = useState<string | null>(null)
  const submitting = useRef(false)
  const promotionStage = promotion && PIPELINE_STAGES.find((stage) => stage.moduleType === promotion.moduleType)
  const formRef = useRef<HTMLFormElement>(null)
  const parentDir = customDirAllowed ? (parent ?? defaultParent) : defaultParent
  const projectId = slugifyProjectId(name)
  const projectDir = parentDir ? joinProjectPath(parentDir, projectId) : ''
  const canCreate = Boolean(name.trim() && (parentDir.trim() || !customDirAllowed) && !creating)
  const canBrowse = customDirAllowed && deploymentMode === 'localBundle' && Boolean(window.electronAPI?.selectDirectory)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    formRef.current?.querySelector('input')?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    setExistingDir(null)
    setError('')
  }, [name, parentDir, customDirAllowed])

  const browse = async () => {
    try {
      const selected = await window.electronAPI?.selectDirectory?.()
      if (selected) setParent(selected)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const create = async () => {
    if (!canCreate || submitting.current) return
    submitting.current = true
    setCreating(true)
    setError('')
    try {
      const id = await createProjectShell(name.trim(), {
        projectId,
        projectParentDir: customDirAllowed ? parentDir.trim() : undefined,
        ...(existingDir ? { allowExistingDir: true } : {}),
      })
      if (promotion) {
        try {
          const attached = await attachChatContext(id, promotion.chatId, useAgentStore.getState().getProjectLogs(promotion.chatId))
          useUiStore.getState().requestModuleStart({
            projectId: id,
            moduleType: promotion.moduleType,
            intent: promotedIntent(attached.path, lang),
            contextPath: attached.path,
          })
        } catch (err) {
          try {
            // Reused workspaces may contain user data from before this request.
            await useProjectStore.getState().deleteTask(id, !existingDir)
          } catch {
            // Keep the attachment error; cleanup can be retried from the queue.
          }
          throw err
        }
        useChatStore.getState().removeChat(promotion.chatId)
      }
      const task = useProjectStore.getState().tasks.find((item) => item.id === id)
      useUiStore.getState().pushSystemMessage(
        t('projectCreatedAt', lang, { name: task?.label || name.trim(), path: task?.projectDir || projectDir }),
        { severity: 'success', ttlMs: 7000 },
      )
      onClose()
    } catch (err) {
      if (err instanceof ProjectDirectoryExistsError) {
        setExistingDir(err.projectDir)
      } else {
        setError(t('projectCreateFailed', lang, { reason: err instanceof Error ? err.message : String(err) }))
      }
      submitting.current = false
      setCreating(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] p-4">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        aria-busy={creating}
        onSubmit={(event) => { event.preventDefault(); void create() }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!submitting.current) onClose()
          }
          if (event.key === 'Tab') {
            const controls = formRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
            if (!controls?.length) return
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
          }
        }}
        className="w-full max-w-[480px] space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 shadow-2xl"
      >
        <h2 id="create-project-title" className="text-base font-semibold text-[var(--color-text-primary)]">{promotionStage
          ? t('promoteToWorkflowTitle', lang, { module: lang === 'zh' ? promotionStage.zh : promotionStage.en })
          : t('newProjectAria', lang)}</h2>
        {promotion && <p className="text-xs text-[var(--color-text-muted)]">{t('promoteContextAttachmentNotice', lang)}</p>}
        <label className="block space-y-2 text-xs text-[var(--color-text-secondary)]">
          <span>{t('projectName', lang)}</span>
          <input required value={name} disabled={creating} onChange={(event) => setName(event.target.value)} placeholder={t('projectNamePlaceholder', lang)} className={inputClass} />
        </label>
        <div className="space-y-2">
          <label htmlFor="create-project-parent" className="text-xs text-[var(--color-text-secondary)]">{t('projectLocation', lang)}</label>
          <div className="flex items-center gap-2">
            <input id="create-project-parent" required={customDirAllowed} readOnly={!customDirAllowed} disabled={creating} value={parentDir} onChange={(event) => setParent(event.target.value)} placeholder={t('projectLocationPlaceholder', lang)} className={`${inputClass} min-w-0 flex-1`} />
            {canBrowse && <button type="button" disabled={creating} onClick={() => { void browse() }} className="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">{t('browseFolder', lang)}</button>}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{t(customDirAllowed ? 'projectParentLocationHint' : 'managedProjectLocationHint', lang)}</p>
        </div>
        {name.trim() && projectDir && <p aria-live="polite" className="break-all rounded-lg bg-[var(--color-bg-primary)] p-3 text-xs text-[var(--color-text-secondary)]">{t('projectDirectoryPreview', lang, { path: projectDir })}</p>}
        {existingDir && <p role="alert" className="break-words text-xs text-[var(--color-text-secondary)]">{t('projectDirectoryExists', lang, { path: existingDir })}</p>}
        {error && <p role="alert" className="break-words text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={creating} onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)] disabled:opacity-40">{t('cancel', lang)}</button>
          <button type="submit" disabled={!canCreate} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs text-white disabled:opacity-40">{t(creating ? 'creating' : existingDir ? 'createInExistingDirectory' : 'createProject', lang)}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
