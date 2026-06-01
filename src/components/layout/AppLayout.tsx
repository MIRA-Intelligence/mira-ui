import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { PipelineProgress } from '@/components/pipeline/PipelineProgress'
import { ProjectQueue } from '@/components/queue/ProjectQueue'
import { ExperimentTimeline } from '@/components/experiment/ExperimentTimeline'
import { TaskDetail } from '@/components/task/TaskDetail'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { SkillsPluginsModal } from '@/components/settings/SkillsPluginsModal'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { UpdateBanner } from '@/components/update/UpdateBanner'
import { LocalEngineUpdateModal } from '@/components/engine/LocalEngineUpdateModal'
import { useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// Draggable splitter. Uses pointer capture so the drag keeps tracking even
// when the cursor leaves the 4px strip. Reports the raw clientX; the caller
// converts that into a (clamped) panel width.
function ResizeHandle({
  onMove,
  onStart,
  onEnd,
  ariaLabel,
}: {
  onMove: (clientX: number) => void
  onStart: () => void
  onEnd: () => void
  ariaLabel: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        onStart()
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return
        onMove(e.clientX)
      }}
      onPointerUp={(e) => {
        ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
        onEnd()
      }}
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-[var(--color-accent)] active:bg-[var(--color-accent)] transition-colors"
    />
  )
}

export function AppLayout() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    agentPanelCollapsed,
    toggleAgentPanel,
    sidebarWidth,
    setSidebarWidth,
    agentPanelWidth,
    setAgentPanelWidth,
  } = useUiStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const activeStage = useProjectStore((s) => s.activeStage)
  const appMode = useProjectStore((s) => s.appMode)
  const lang = useSettingsStore((s) => s.language)
  // In Quick Chat the conversation IS the primary content, so it takes the
  // center column and the right agent panel (and project-only experiment
  // timeline) are hidden. Project mode keeps the 3-column research layout.
  const isChat = appMode === 'normal'
  // Suppress width transitions while actively dragging a splitter so the panel
  // tracks the cursor 1:1 instead of easing behind it.
  const [resizing, setResizing] = useState(false)
  useWebSocket()
  useUpdateCheck()

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <UpdateBanner />
      <PipelineProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Projects sidebar — collapsible + resizable */}
        <div
          className={cn(
            'shrink-0 overflow-hidden',
            !resizing && 'transition-[width] duration-200 ease-in-out',
          )}
          style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>
            <ProjectQueue />
          </div>
        </div>

        {/* Left sidebar resize handle */}
        {!sidebarCollapsed && (
          <ResizeHandle
            ariaLabel={t('toggleSidebar', lang)}
            onStart={() => setResizing(true)}
            onEnd={() => setResizing(false)}
            onMove={(clientX) => setSidebarWidth(clientX)}
          />
        )}

        {/* Left sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="w-5 shrink-0 flex items-center justify-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
          aria-label={t('toggleSidebar', lang)}
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>

        {/* Experiment timeline — visible in the experiment stage (project only) */}
        {!isChat && selectedTaskId && activeStage === 'experiment' && (
          <div className="w-[180px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <ExperimentTimeline />
          </div>
        )}

        {/* Center: the chat (Quick Chat) or the project's Experiment Detail */}
        <div className="flex-1 overflow-hidden min-w-0">
          {isChat ? <AgentPanel /> : <TaskDetail />}
        </div>

        {/* Right agent panel — project mode only (in chat mode the chat is centered) */}
        {!isChat && (
          <>
            <button
              onClick={toggleAgentPanel}
              className="w-5 shrink-0 flex items-center justify-center border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
              aria-label={t('toggleAgentPanel', lang)}
            >
              {agentPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
            </button>

            {/* Right panel resize handle */}
            {!agentPanelCollapsed && (
              <ResizeHandle
                ariaLabel={t('toggleAgentPanel', lang)}
                onStart={() => setResizing(true)}
                onEnd={() => setResizing(false)}
                onMove={(clientX) => setAgentPanelWidth(window.innerWidth - clientX)}
              />
            )}

            <div
              className={cn(
                'shrink-0 overflow-hidden',
                !resizing && 'transition-[width] duration-200 ease-in-out',
              )}
              style={{ width: agentPanelCollapsed ? 0 : agentPanelWidth }}
            >
              <div className="h-full" style={{ width: agentPanelWidth }}>
                <AgentPanel />
              </div>
            </div>
          </>
        )}
      </div>

      <StatusBar />
      <SettingsModal />
      <LocalEngineUpdateModal />
      <SkillsPluginsModal />
      <NewProjectModal />
    </div>
  )
}
