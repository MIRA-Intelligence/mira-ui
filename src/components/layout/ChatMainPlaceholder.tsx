import { useMemo, type ReactNode } from 'react'
import { ArtifactPreview } from '@/components/artifacts'
import { getProjectArtifactUrl } from '@/services/api'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const RECENT_PROJECT_LIMIT = 5

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
  const openNewProject = useUiStore((s) => s.openNewProject)
  const tasks = useProjectStore((s) => s.tasks)
  const selectTask = useProjectStore((s) => s.selectTask)
  const createChat = useChatStore((s) => s.createChat)

  const recentProjects = useMemo(
    () => tasks.slice(0, RECENT_PROJECT_LIMIT),
    [tasks],
  )

  const usePrompt = (key: (typeof PROMPT_KEYS)[number]) => {
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
              const url = getProjectArtifactUrl(previewFile.projectId, previewFile.relativePath)
              const link = document.createElement('a')
              link.href = url
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
            url={getProjectArtifactUrl(previewFile.projectId, previewFile.relativePath)}
            enabled
            label={previewFile.name}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-primary)]">
      <div className="max-w-xl mx-auto px-8 py-10 flex flex-col gap-8">
        <header className="text-center space-y-2">
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
          <ActionButton onClick={() => openNewProject()}>
            {t('newProject', lang)}
          </ActionButton>
        </div>

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
    </div>
  )
}

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
      className={cn(
        'px-4 py-2 rounded-lg text-sm font-medium',
        'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
        'hover:bg-[var(--color-accent)]/25 transition-colors',
      )}
    >
      {children}
    </button>
  )
}
