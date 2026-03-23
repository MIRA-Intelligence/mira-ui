import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { PipelineProgress } from '@/components/pipeline/PipelineProgress'
import { ProjectQueue } from '@/components/queue/ProjectQueue'
import { TaskDetail } from '@/components/task/TaskDetail'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { useUiStore } from '@/stores/uiStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'

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

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, agentPanelCollapsed, toggleAgentPanel } = useUiStore()
  useWebSocket()

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <PipelineProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Projects sidebar — collapsible */}
        <div
          className={cn(
            'shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden',
            sidebarCollapsed ? 'w-0' : 'w-[160px]',
          )}
        >
          <div className="w-[160px] h-full">
            <ProjectQueue />
          </div>
        </div>

        {/* Left sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="w-5 shrink-0 flex items-center justify-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>

        {/* Center: Task Detail — always flex-1, takes remaining space */}
        <div className="flex-1 overflow-hidden min-w-0">
          <TaskDetail />
        </div>

        {/* Right sidebar toggle */}
        <button
          onClick={toggleAgentPanel}
          className="w-5 shrink-0 flex items-center justify-center border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
          aria-label="Toggle agent panel"
        >
          {agentPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
        </button>

        {/* Right: Agent Panel — collapsible with concrete width transition */}
        <div
          className={cn(
            'shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden',
            agentPanelCollapsed ? 'w-0' : 'w-[45vw]',
          )}
        >
          <div className="w-[45vw] h-full">
            <AgentPanel />
          </div>
        </div>
      </div>

      <StatusBar />
      <SettingsModal />
      <NewProjectModal />
    </div>
  )
}
