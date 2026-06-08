import type { ReactNode } from 'react'
import { AgentPanel } from './AgentPanel'
import { buildPromotePrefill } from './promote'
import { ResourceExplorer } from '@/components/project/ResourceExplorer'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

function WorkbenchTabButton({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-xs font-semibold tracking-wide uppercase transition-colors border-b-2 flex items-center justify-center gap-1.5 min-w-0',
        active
          ? 'text-[var(--color-text-primary)] border-[var(--color-accent)] bg-[var(--color-bg-primary)]'
          : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Right workbench: switch between file explorer and agent chat in one panel. */
export function AgentWorkspacePanel() {
  const lang = useSettingsStore((s) => s.language)
  const workbenchTab = useUiStore((s) => s.workbenchTab)
  const setWorkbenchTab = useUiStore((s) => s.setWorkbenchTab)
  const openNewProject = useUiStore((s) => s.openNewProject)
  const connected = useAgentStore((s) => s.connected)
  const logsByProject = useAgentStore((s) => s.logsByProject)
  const appMode = useProjectStore((s) => s.appMode)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const mode = useProjectStore((s) => s.mode)
  const activeChatId = useChatStore((s) => s.activeChatId)

  const isChat = appMode === 'normal'
  const sessionId = isChat ? activeChatId : selectedTaskId
  const isAuto = appMode === 'project' && mode === 'auto'
  const logs = sessionId ? (logsByProject[sessionId] ?? []) : []

  return (
    <div className="flex flex-col h-full min-w-0 bg-[var(--color-bg-secondary)]">
      <div
        className={cn(
          'flex shrink-0 items-stretch border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]',
          workbenchTab === 'agent' && 'bg-[var(--color-bg-primary)]',
        )}
      >
        <WorkbenchTabButton
          active={workbenchTab === 'files'}
          onClick={() => setWorkbenchTab('files')}
          className="flex-1"
        >
          {t('filesTab', lang)}
        </WorkbenchTabButton>

        <WorkbenchTabButton
          active={workbenchTab === 'agent'}
          onClick={() => setWorkbenchTab('agent')}
          className="flex-1"
        >
          <span className="truncate">{t('agentChat', lang)}</span>
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]',
            )}
            title={connected ? t('connected', lang) : t('disconnected', lang)}
          />
          {isAuto && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)] font-medium normal-case tracking-normal shrink-0">
              AUTO
            </span>
          )}
        </WorkbenchTabButton>

        {workbenchTab === 'agent' && (
          <div className="flex items-center gap-2 px-2 shrink-0 border-b-2 border-[var(--color-accent)] bg-[var(--color-bg-primary)]">
            {sessionId && isChat && (
              <button
                type="button"
                onClick={() =>
                  openNewProject({ prefill: buildPromotePrefill(logs), fromChatId: sessionId })
                }
                title={t('promoteToProjectHint', lang)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 transition-colors whitespace-nowrap"
              >
                {t('promoteToProject', lang)}
              </button>
            )}
            {sessionId && appMode === 'project' && (
              <span className="text-[10px] font-mono text-[var(--color-text-muted)] truncate max-w-[140px]">
                {sessionId}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {workbenchTab === 'files' ? (
          <ResourceExplorer embedded />
        ) : (
          <AgentPanel embeddedInWorkbench />
        )}
      </div>
    </div>
  )
}
