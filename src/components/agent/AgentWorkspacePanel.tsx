import type { ReactNode } from 'react'
import { AgentPanel, AgentPanelActions } from './AgentPanel'
import { ResourceExplorer } from '@/components/project/ResourceExplorer'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/** Browser-style tab: sized to its label, the active one joins the panel below. */
function WorkbenchTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 min-w-0 max-w-[180px] px-3 py-1.5 -mb-px rounded-t-md border text-xs transition-colors',
        active
          ? 'border-[var(--color-border)] border-b-[var(--color-bg-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] font-medium'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
      )}
    >
      {children}
    </button>
  )
}

/** Right workbench: the agent conversation and the file explorer as tabs. */
export function AgentWorkspacePanel() {
  const lang = useSettingsStore((s) => s.language)
  const workbenchTab = useUiStore((s) => s.workbenchTab)
  const setWorkbenchTab = useUiStore((s) => s.setWorkbenchTab)
  const connected = useAgentStore((s) => s.connected)

  return (
    <div className="flex flex-col h-full min-w-0 bg-[var(--color-bg-primary)]">
      <div className="flex shrink-0 items-end gap-1 px-2 pt-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div role="tablist" className="flex items-end gap-0.5 min-w-0">
          <WorkbenchTab active={workbenchTab === 'agent'} onClick={() => setWorkbenchTab('agent')}>
            <span className="truncate">{t('agentChat', lang)}</span>
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]',
              )}
              title={connected ? t('connected', lang) : t('disconnected', lang)}
              aria-label={connected ? t('connected', lang) : t('disconnected', lang)}
            />
          </WorkbenchTab>
          <WorkbenchTab active={workbenchTab === 'files'} onClick={() => setWorkbenchTab('files')}>
            <span className="truncate">{t('filesTab', lang)}</span>
          </WorkbenchTab>
        </div>

        {workbenchTab === 'agent' && (
          <div className="flex flex-1 items-center justify-end gap-2 min-w-0 pb-1 text-[10px] text-[var(--color-text-muted)] font-mono">
            <AgentPanelActions />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {workbenchTab === 'files' ? (
          <ResourceExplorer embedded />
        ) : (
          <AgentPanel showHeader={false} />
        )}
      </div>
    </div>
  )
}
