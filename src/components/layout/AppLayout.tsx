import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { PipelineProgress } from '@/components/pipeline/PipelineProgress'
import { ProjectQueue } from '@/components/queue/ProjectQueue'
import { TaskDetail } from '@/components/task/TaskDetail'
import { AgentLog } from '@/components/agent/AgentLog'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { useUiStore } from '@/stores/uiStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, chatOpen, toggleChat } = useUiStore()
  useWebSocket()

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <PipelineProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Queue — collapsible */}
        <div
          className={cn(
            'shrink-0 transition-all duration-200 ease-in-out overflow-hidden',
            sidebarCollapsed ? 'w-0' : 'w-[160px]',
          )}
        >
          <ProjectQueue />
        </div>

        {/* Left sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="w-4 shrink-0 flex items-center justify-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)] text-[10px]"
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? '▸' : '◂'}
        </button>

        {/* Center: Task Detail */}
        <div className="flex-1 border-r border-[var(--color-border)] overflow-hidden min-w-0">
          <TaskDetail />
        </div>

        {/* Right: Agent Log */}
        <div className="flex-1 overflow-hidden min-w-0 relative">
          <AgentLog />
          {/* Chat toggle button — anchored bottom-right of log panel */}
          {!chatOpen && (
            <button
              onClick={toggleChat}
              className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-[var(--color-accent)] text-white shadow-lg flex items-center justify-center hover:bg-[var(--color-accent)]/80 transition-colors"
              aria-label="Open chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}
        </div>

        {/* Right sidebar: Chat Panel — slides in */}
        <div
          className={cn(
            'shrink-0 transition-all duration-200 ease-in-out overflow-hidden',
            chatOpen ? 'w-[360px]' : 'w-0',
          )}
        >
          <div className="w-[360px] h-full">
            <ChatPanel />
          </div>
        </div>
      </div>

      <StatusBar />
      <SettingsModal />
    </div>
  )
}
