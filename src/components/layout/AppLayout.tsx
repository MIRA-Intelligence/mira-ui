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

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, agentPanelCollapsed, toggleAgentPanel } = useUiStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const activeStage = useProjectStore((s) => s.activeStage)
  const lang = useSettingsStore((s) => s.language)
  useWebSocket()
  useUpdateCheck()

  return (
    <div className="h-screen flex flex-col">
      <TopBar />
      <UpdateBanner />
      <PipelineProgress />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Projects sidebar — collapsible */}
        <div
          className={cn(
            'shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden',
            sidebarCollapsed ? 'w-0' : 'w-[140px]',
          )}
        >
          <div className="w-[140px] h-full">
            <ProjectQueue />
          </div>
        </div>

        {/* Left sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="w-5 shrink-0 flex items-center justify-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
          aria-label={t('toggleSidebar', lang)}
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>

        {/* Experiment timeline — visible in the experiment stage */}
        {selectedTaskId && activeStage === 'experiment' && (
          <div className="w-[180px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <ExperimentTimeline />
          </div>
        )}

        {/* Center: Experiment Detail / Knowledge */}
        <div className="flex-1 overflow-hidden min-w-0">
          <TaskDetail />
        </div>

        {/* Right sidebar toggle */}
        <button
          onClick={toggleAgentPanel}
          className="w-5 shrink-0 flex items-center justify-center border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-muted)]"
          aria-label={t('toggleAgentPanel', lang)}
        >
          {agentPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
        </button>

        {/* Right: Agent Panel — collapsible */}
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
      <SkillsPluginsModal />
      <NewProjectModal />
    </div>
  )
}
