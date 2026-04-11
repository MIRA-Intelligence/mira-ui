import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import type { AgentProfile, PipelineStage } from '@/types'
import { t } from '@/i18n'

const STAGES: { key: PipelineStage; icon: string }[] = [
  { key: 'research', icon: '📚' },
  { key: 'experiment', icon: '🔬' },
  { key: 'result', icon: '📝' },
]

const AGENT_PROFILES: { key: AgentProfile; labelKey: 'engineerMode' | 'balancedMode' | 'researchMode' }[] = [
  { key: 'engineer', labelKey: 'engineerMode' },
  { key: 'default', labelKey: 'balancedMode' },
  { key: 'research', labelKey: 'researchMode' },
]

const AGENT_PROFILE_OFFSET: Record<AgentProfile, number> = {
  engineer: 0,
  default: 100,
  research: 200,
}

function stageBadge(task: ReturnType<typeof useProjectStore.getState>['tasks'][0], stage: PipelineStage): string | null {
  if (stage === 'research') {
    const count = task.research.references.length
    return count > 0 ? `${count}` : null
  }
  if (stage === 'experiment') {
    const c = task.experiments.filter((e) => e.status === 'completed' || e.status === 'skipped').length
    const t = task.experiments.length
    return t > 0 ? `${c}/${t}` : null
  }
  if (stage === 'result') {
    const has = task.result?.summary || (task.result?.sections?.length ?? 0) > 0
    return has ? '✓' : null
  }
  return null
}

export function PipelineProgress() {
  const {
    tasks,
    selectedTaskId,
    activeStage,
    mode,
    agentProfile,
    setActiveStage,
    setAgentProfile,
  } = useProjectStore()
  const isStreaming = useAgentStore((s) => s.isStreaming)
  const lang = useSettingsStore((s) => s.language)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const openSkillsPlugins = useUiStore((s) => s.openSkillsPlugins)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const hasRunningExperiment = !!task?.experiments.some((e) => e.status === 'running')
  const canSwitchAgentProfile = !isStreaming && !hasRunningExperiment
  const agentProfileSlider = (
    <div className="min-w-[210px] shrink-0">
      <div
        className={cn(
          'relative w-full rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 transition-opacity',
          !canSwitchAgentProfile && 'opacity-60',
        )}
        title={!canSwitchAgentProfile ? t('profileSwitchManualOnly', lang) : undefined}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 top-1 bottom-1 rounded-full bg-[var(--color-accent)]/25 transition-transform duration-200 ease-out"
          style={{
            width: 'calc((100% - 0.5rem) / 3)',
            transform: `translateX(${AGENT_PROFILE_OFFSET[agentProfile]}%)`,
          }}
        />
        <div className="relative z-10 grid grid-cols-3">
          {AGENT_PROFILES.map((profile) => (
            <button
              key={profile.key}
              type="button"
              onClick={() => {
                if (!canSwitchAgentProfile) return
                setAgentProfile(profile.key)
              }}
              disabled={!canSwitchAgentProfile}
              className={cn(
                'py-1 text-xs font-medium rounded-full transition-colors',
                agentProfile === profile.key
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)]',
                canSwitchAgentProfile && 'hover:text-[var(--color-text-secondary)]',
                !canSwitchAgentProfile && 'cursor-not-allowed',
              )}
            >
              {t(profile.labelKey, lang)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
  const toolButtons = (
    <div className="shrink-0 flex items-center gap-1">
      <button
        onClick={openSettings}
        className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        aria-label={t('settings', lang)}
        title={t('settings', lang)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button
        onClick={openSkillsPlugins}
        className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        aria-label={t('skillsPlugins', lang)}
        title={t('skillsPlugins', lang)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </button>
    </div>
  )

  if (!task) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        {toolButtons}
        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
        {agentProfileSlider}
        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
        <span className="text-xs text-[var(--color-text-muted)]">{t('noProjectSelected', lang)}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-2 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {toolButtons}
      <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
      {agentProfileSlider}

      <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />

      {/* Stage tabs */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        {STAGES.map((stage, idx) => {
          const isActive = activeStage === stage.key
          const badge = stageBadge(task, stage.key)

          return (
            <div key={stage.key} className="flex items-center">
              {idx > 0 && (
                <div className="w-6 h-px bg-[var(--color-border)] mx-0.5" />
              )}
              <button
                onClick={() => setActiveStage(stage.key)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all select-none ${
                  isActive
                    ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <span className="text-[13px]">{stage.icon}</span>
                <span>{t(stage.key === 'research' ? 'research' : stage.key === 'experiment' ? 'experiment' : 'result', lang)}</span>
                {badge && (
                  <span className={`text-[10px] font-mono px-1 py-px rounded ${
                    isActive
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--color-accent)]/8">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span className="text-[10px] text-[var(--color-accent)] font-medium">{t('working', lang)}</span>
        </div>
      )}

      {/* Core question (if short) */}
      {task.coreQuestion && (
        <p className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[300px] shrink-0">
          {task.coreQuestion}
        </p>
      )}
    </div>
  )
}
