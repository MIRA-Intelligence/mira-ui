import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import miraLogo from '@/assets/mira-logo.png'
import { ArtifactPreview } from '@/components/artifacts'
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog'
import { detectArtifactKind, isPreviewableInline } from '@/components/artifacts/detectKind'
import {
  fetchChatWorkdir,
  fetchDirectory,
  getArtifactDownloadUrl,
  getExplorerFileUrl,
  uploadToFolder,
} from '@/services/api'
import type { ProjectFileInfo } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const RECENT_PROJECT_LIMIT = 5
const RECENT_CHAT_LIMIT = 5
const CHAT_FILE_LIMIT = 5

const PROMPT_KEYS = [
  'chatHomePromptResearch',
  'chatHomePromptSummarize',
  'chatHomePromptExplainFile',
] as const

function formatProjectStatus(
  status: 'in_progress' | 'completed' | 'pending',
  lang: ReturnType<typeof useSettingsStore.getState>['language'],
): string {
  switch (status) {
    case 'completed':
      return t('projectStatusCompleted', lang)
    case 'pending':
      return t('projectStatusPending', lang)
    default:
      return t('projectStatusInProgress', lang)
  }
}

export function ChatMainPlaceholder() {
  const lang = useSettingsStore((s) => s.language)
  const previewFile = useUiStore((s) => s.chatCenterPreviewFile)
  const setChatCenterPreviewFile = useUiStore((s) => s.setChatCenterPreviewFile)
  const setAgentDraftPrompt = useUiStore((s) => s.setAgentDraftPrompt)
  const focusQuickChatWorkbench = useUiStore((s) => s.focusQuickChatWorkbench)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const pushSystemMessage = useUiStore((s) => s.pushSystemMessage)
  const chatFilesRevision = useUiStore((s) => s.chatFilesRevision)
  const bumpChatFiles = useUiStore((s) => s.bumpChatFiles)
  const tasks = useProjectStore((s) => s.tasks)
  const selectTask = useProjectStore((s) => s.selectTask)
  const createChat = useChatStore((s) => s.createChat)
  const selectChat = useChatStore((s) => s.selectChat)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const [chatFiles, setChatFiles] = useState<ProjectFileInfo[]>([])
  const [uploading, setUploading] = useState(false)
  const uploadInputId = useId()

  const recentProjects = useMemo(
    () => tasks.slice(0, RECENT_PROJECT_LIMIT),
    [tasks],
  )
  // Chats that have begun, so there is something to go back to.
  const recentChats = useMemo(
    () => chats
      .filter((chat) => chat.id !== activeChatId && chat.title)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_CHAT_LIMIT),
    [chats, activeChatId],
  )

  // The newest files in this chat's folder (e.g. uploaded before the first message).
  useEffect(() => {
    let cancelled = false
    setChatFiles([])
    if (!activeChatId) return
    void (async () => {
      const workdir = await fetchChatWorkdir(activeChatId)
      if (cancelled || !workdir?.exists) return
      const result = await fetchDirectory(workdir.path)
      if (cancelled || !result.ok) return
      setChatFiles(result.listing.entries
        .filter((entry) => !entry.is_dir)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, CHAT_FILE_LIMIT))
    })()
    return () => {
      cancelled = true
    }
  }, [activeChatId, chatFilesRevision])

  // Upload into this chat's folder (starting a chat if needed), then suggest analysing it.
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    const chatId = useChatStore.getState().activeChatId ?? createChat()
    setUploading(true)
    try {
      const workdir = await fetchChatWorkdir(chatId)
      if (!workdir) throw new Error(t('uploadFailed', lang))
      const uploaded = await uploadToFolder(workdir.path, files)
      bumpChatFiles()
      pushSystemMessage(t('uploadedSuccessfully', lang), { severity: 'success' })
      const names = (uploaded.length ? uploaded : files).map((file) => file.name).join(', ')
      setAgentDraftPrompt(t('chatHomeAnalyzeUploaded', lang, { names }))
    } catch (err: unknown) {
      pushSystemMessage(err instanceof Error ? err.message : t('uploadFailed', lang), { severity: 'error' })
    } finally {
      setUploading(false)
    }
  }

  const usePrompt = (key: (typeof PROMPT_KEYS)[number]) => {
    if (!useChatStore.getState().activeChatId) createChat()
    setAgentDraftPrompt(t(key, lang))
    focusQuickChatWorkbench()
  }

  if (previewFile) {
    return (
      <div className="h-full flex flex-col bg-[var(--color-bg-primary)] min-w-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] shrink-0 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-[var(--color-text-primary)]">
              {previewFile.name}
            </p>
            <p className="text-[10px] font-mono truncate text-[var(--color-text-muted)]">
              {previewFile.path}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const url = getExplorerFileUrl(previewFile)
              const link = document.createElement('a')
              link.href = getArtifactDownloadUrl(url)
              link.download = previewFile.name
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
            }}
            className="px-2 py-1 rounded border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] shrink-0"
            title={t('downloadArtifact', lang)}
          >
            ⬇
          </button>
          <button
            type="button"
            onClick={() => setChatCenterPreviewFile(null)}
            className="px-2 py-1 rounded text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] shrink-0"
            aria-label={t('chatCenterPreviewClose', lang)}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-0">
          <ArtifactPreview
            path={previewFile.relativePath}
            url={getExplorerFileUrl(previewFile)}
            enabled
            label={previewFile.name}
            bodyOnly={isPreviewableInline(detectArtifactKind(previewFile.relativePath))}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-primary)]">
      <div className="max-w-xl mx-auto px-8 py-10 flex flex-col gap-8">
        <header className="text-center space-y-2">
          <img src={miraLogo} alt="MIRA" className="mira-logo mx-auto mb-4 h-14 w-auto select-none" draggable={false} />
          <p className="text-base font-medium text-[var(--color-text-primary)]">
            {t('normalChatTitle', lang)}
          </p>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            {t('normalChatHint', lang)}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] pt-1">
            {t('chatCenterSelectFileHint', lang)}
          </p>
        </header>

        <div className="flex flex-wrap justify-center gap-2">
          <ActionButton onClick={() => createChat()}>
            {t('newChat', lang)}
          </ActionButton>
          <ActionButton onClick={() => setCreateProjectOpen(true)}>
            {t('createProject', lang)}
          </ActionButton>
          <label
            htmlFor={uploadInputId}
            className={cn(actionButtonClass, 'cursor-pointer', uploading && 'pointer-events-none opacity-50')}
          >
            {t('chatHomeUploadData', lang)}
          </label>
          <input
            id={uploadInputId}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => void handleUpload(e)}
          />
        </div>

        {chatFiles.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {t('chatHomeChatFiles', lang)}
            </h2>
            <ul className="space-y-1.5">
              {chatFiles.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setChatCenterPreviewFile({
                      ...file, projectId: '', relativePath: file.name, absolutePath: file.path,
                    })}
                    className="w-full text-left px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-xs font-mono truncate text-[var(--color-text-secondary)]"
                  >
                    {file.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {t('chatHomePrompts', lang)}
          </h2>
          <div className="flex flex-col gap-1.5">
            {PROMPT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => usePrompt(key)}
                className="text-left px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                {t(key, lang)}
              </button>
            ))}
          </div>
        </section>

        {recentChats.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {t('chatHomeRecentChats', lang)}
            </h2>
            <ul className="space-y-1.5">
              {recentChats.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => selectChat(chat.id)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-sm truncate text-[var(--color-text-primary)]"
                  >
                    {chat.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recentProjects.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {t('chatHomeRecentProjects', lang)}
            </h2>
            <ul className="space-y-1.5">
              {recentProjects.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => selectTask(task.id)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-[var(--color-text-muted)] shrink-0">
                        {task.id}
                      </span>
                      <span className="text-sm truncate text-[var(--color-text-primary)]">
                        {task.title || task.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)] mt-0.5 block">
                      {formatProjectStatus(task.status, lang)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {createProjectOpen && <CreateProjectDialog onClose={() => setCreateProjectOpen(false)} />}
    </div>
  )
}

const actionButtonClass = cn(
  'px-4 py-2 rounded-lg text-sm font-medium',
  'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  'hover:bg-[var(--color-accent)]/25 transition-colors',
)

function ActionButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={actionButtonClass}
    >
      {children}
    </button>
  )
}
