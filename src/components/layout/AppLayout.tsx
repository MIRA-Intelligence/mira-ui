import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { TeamAdminBanner } from './TeamAdminBanner'
import { PipelineProgress } from '@/components/pipeline/PipelineProgress'
import { ProjectQueue } from '@/components/queue/ProjectQueue'
import { ExperimentTimeline } from '@/components/experiment/ExperimentTimeline'
import { TaskDetail } from '@/components/task/TaskDetail'
import { AgentWorkspacePanel } from '@/components/agent/AgentWorkspacePanel'
import { ChatMainPlaceholder } from './ChatMainPlaceholder'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { SkillsPluginsModal } from '@/components/settings/SkillsPluginsModal'
import { ProvidersPage } from '@/components/providers/ProvidersPage'
import { TeamUsagePage } from '@/components/team/TeamUsagePage'
import { KnowledgePage } from '@/components/knowledge/KnowledgePage'
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog'
import { UpdateBanner } from '@/components/update/UpdateBanner'
import { LocalEngineUpdateModal } from '@/components/engine/LocalEngineUpdateModal'
import { SshPromptDialog } from '@/components/settings/SshPromptDialog'
import { RemoteInstallDialog } from '@/components/settings/RemoteInstallDialog'
import { TeamServerLoginDialog } from '@/components/settings/TeamServerLoginDialog'
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useTurnSync } from '@/hooks/useTurnSync'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { useWorkflowWebSocket } from '@/hooks/useWorkflowWebSocket'
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
    chatCenterCollapsed,
    toggleChatCenter,
    setChatCenterCollapsed,
    promotion,
    closePromotion,
  } = useUiStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const activeStage = useProjectStore((s) => s.activeStage)
  const appMode = useProjectStore((s) => s.appMode)
  const lang = useSettingsStore((s) => s.language)
  // Quick Chat previews files in the center and keeps its conversation in the
  // workbench. Collapsing the center gives the conversation the available space.
  const isChat = appMode === 'normal'
  const isProjectOverview = !isChat && activeStage === 'modules'
  const centerCollapsed = isChat && chatCenterCollapsed
  const workbenchWidth = !isChat && agentPanelCollapsed ? 0 : centerCollapsed ? undefined : agentPanelWidth
  // Suppress width transitions while actively dragging a splitter so the panel
  // tracks the cursor 1:1 instead of easing behind it.
  const [resizing, setResizing] = useState(false)
  const flushPendingFeedback = useFeedbackStore((s) => s.flushPending)
  useWebSocket()
  useWorkflowWebSocket()
  useTurnSync()
  useUpdateCheck()

  useEffect(() => {
    void flushPendingFeedback()
  }, [flushPendingFeedback])

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <TeamAdminBanner />
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

        {/* Center: file preview/home in Quick Chat, or the project detail. */}
        <div
          hidden={centerCollapsed}
          className={cn(
            'overflow-hidden',
            centerCollapsed ? 'w-0' : 'flex-1',
            // Dragging the workbench wider must not squeeze the chat home away.
            isChat && !centerCollapsed ? 'min-w-[280px]' : 'min-w-0',
          )}
        >
          {isChat ? <ChatMainPlaceholder /> : <TaskDetail />}
        </div>

        {/* Quick Chat: click collapses the home pane, drag resizes the workbench. */}
        {isChat && (
          <SplitterToggle
            onToggle={toggleChatCenter}
            onStart={() => {
              setChatCenterCollapsed(false)
              setResizing(true)
            }}
            onEnd={() => setResizing(false)}
            onMove={(clientX) => setAgentPanelWidth(window.innerWidth - clientX)}
            className="border-l border-[var(--color-border)]"
            ariaLabel={t('toggleChatCenter', lang)}
          >
            {chatCenterCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </SplitterToggle>
        )}

        {!isProjectOverview && (
          <>
            {!isChat && (
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
            )}

            <div
              className={cn(
                'overflow-hidden',
                // In Quick Chat the workbench gives way to the home pane's minimum on narrow windows.
                isChat ? 'shrink min-w-0' : 'shrink-0',
                centerCollapsed && 'flex-1',
                !resizing && 'transition-[width] duration-200 ease-in-out',
              )}
              style={{ width: workbenchWidth }}
            >
              <div className="h-full" style={{ width: isChat ? '100%' : agentPanelWidth }}>
                <AgentWorkspacePanel />
              </div>
            </div>
          </>
        )}
      </div>

      <StatusBar />
      <SettingsModal />
      <LocalEngineUpdateModal />
      <RemoteInstallDialog />
      <SshPromptDialog />
      <TeamServerLoginDialog />
      <SkillsPluginsModal />
      <ProvidersPage />
      <TeamUsagePage />
      <KnowledgePage />
      {promotion && <CreateProjectDialog key={promotion.chatId} promotion={promotion} onClose={closePromotion} />}
      <FeedbackDialog />
    </div>
  )
}
