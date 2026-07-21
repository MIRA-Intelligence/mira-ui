import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { PipelineProgress } from '@/components/pipeline/PipelineProgress'
import { ProjectQueue } from '@/components/queue/ProjectQueue'
import { ExperimentTimeline } from '@/components/experiment/ExperimentTimeline'
import { TaskDetail } from '@/components/task/TaskDetail'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { SkillsPluginsModal } from '@/components/settings/SkillsPluginsModal'
import { ProvidersPage } from '@/components/providers/ProvidersPage'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { UpdateBanner } from '@/components/update/UpdateBanner'
import { LocalEngineUpdateModal } from '@/components/engine/LocalEngineUpdateModal'
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useFeedbackStore } from '@/stores/feedbackStore'
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

const DRAG_START_THRESHOLD_PX = 4

function SplitterToggle({
  ariaLabel,
  className,
  onToggle,
  onMove,
  onStart,
  onEnd,
  children,
}: {
  ariaLabel: string
  className?: string
  onToggle: () => void
  onMove: (clientX: number) => void
  onStart: () => void
  onEnd: () => void
  children: ReactNode
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; dragging: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  const endDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    if (drag.dragging) {
      onEnd()
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
          return
        }
        onToggle()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragRef.current = { pointerId: e.pointerId, startX: e.clientX, dragging: false }
        suppressClickRef.current = false
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        if (!drag.dragging && Math.abs(e.clientX - drag.startX) >= DRAG_START_THRESHOLD_PX) {
          drag.dragging = true
          suppressClickRef.current = true
          onStart()
        }
        if (drag.dragging) {
          e.preventDefault()
          onMove(e.clientX)
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'w-4 shrink-0 flex items-center justify-center bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)] cursor-col-resize select-none',
        className,
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
    >
      {children}
    </button>
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
    setSidebarCollapsed,
    setAgentPanelCollapsed,
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
  const flushPendingFeedback = useFeedbackStore((s) => s.flushPending)
  useWebSocket()
  useUpdateCheck()

  useEffect(() => {
    void flushPendingFeedback()
  }, [flushPendingFeedback])

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

        {/* Left sidebar toggle */}
        <SplitterToggle
          onToggle={toggleSidebar}
          onStart={() => {
            setSidebarCollapsed(false)
            setResizing(true)
          }}
          onEnd={() => setResizing(false)}
          onMove={(clientX) => setSidebarWidth(clientX)}
          className="border-r border-[var(--color-border)]"
          ariaLabel={t('toggleSidebar', lang)}
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </SplitterToggle>

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
            <SplitterToggle
              onToggle={toggleAgentPanel}
              onStart={() => {
                setAgentPanelCollapsed(false)
                setResizing(true)
              }}
              onEnd={() => setResizing(false)}
              onMove={(clientX) => setAgentPanelWidth(window.innerWidth - clientX)}
              className="border-l border-[var(--color-border)]"
              ariaLabel={t('toggleAgentPanel', lang)}
            >
              {agentPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
            </SplitterToggle>

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
      <ProvidersPage />
      <NewProjectModal />
      <FeedbackDialog />
    </div>
  )
}
