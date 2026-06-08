import { useLayoutEffect, useState } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import type { AgentProfile, ContractVersion, PipelineStage } from '@/types'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'

// Minimum useful width (px) for the truncated coreQuestion line. If the row
// has less remaining space than this after laying out everything else, the
// coreQuestion is hidden entirely instead of being allowed to overlap the
// stage tabs (issue #20).
const MIN_QUESTION_PX = 140
const MAX_QUESTION_PX = 300
// Visual gap between the fixed-content block and the coreQuestion (matches
// the `pl-3` on the <p>).
const QUESTION_GAP_PX = 12

const STAGES: { key: PipelineStage; icon: string; labelKey: I18nKey }[] = [
  { key: 'research', icon: '📚', labelKey: 'research' },
  { key: 'plan', icon: '🗺️', labelKey: 'plan' },
  { key: 'experiment', icon: '🔬', labelKey: 'experiment' },
  { key: 'result', icon: '📝', labelKey: 'result' },
]

const PROFILE_OPTIONS: Array<{ key: AgentProfile; labelKey: 'engineerMode' | 'researchMode' }> = [
  { key: 'engineer', labelKey: 'engineerMode' },
  { key: 'research', labelKey: 'researchMode' },
]

const CONTRACT_MODES: { key: ContractVersion; labelKey: 'contractCompat' | 'contractStrict' }[] = [
  { key: 1, labelKey: 'contractCompat' },
  { key: 2, labelKey: 'contractStrict' },
]

function stageBadge(task: ReturnType<typeof useProjectStore.getState>['tasks'][0], stage: PipelineStage): string | null {
  if (stage === 'research') {
    const count = task.research.references.length
    return count > 0 ? `${count}` : null
  }
  if (stage === 'plan') {
    const phase = task.plan?.phase
    if (phase === 'questions' || phase === 'draft') return '!'
    if (phase === 'approved') return '✓'
    return null
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
    appMode,
    selectedTaskId,
    activeStage,
    agentProfile,
    contractVersion,
    setActiveStage,
    setAgentProfile,
    setContractVersion,
  } = useProjectStore()
  const isStreaming = useAgentStore((s) => (selectedTaskId ? (s.streamingBySession[selectedTaskId] ?? false) : false))
  const lang = useSettingsStore((s) => s.language)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const openSkillsPlugins = useUiStore((s) => s.openSkillsPlugins)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const hasRunningExperiment = !!task?.experiments.some((e) => e.status === 'running')
  const canSwitchAgentProfile = !isStreaming && !hasRunningExperiment
  const canSwitchContractVersion = !isStreaming && !hasRunningExperiment
  const effectiveContractVersion = task?.contractVersion ?? contractVersion
  const agentProfileSlider = (
    <div className="shrink-0">
      <div
        className={cn(
          'relative grid w-32 grid-cols-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-0.5 transition-opacity',
          !canSwitchAgentProfile && 'opacity-60',
        )}
        title={!canSwitchAgentProfile ? t('profileSwitchManualOnly', lang) : undefined}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-[var(--color-accent)]/20 transition-transform duration-200 ease-out"
          style={{
            left: '0.125rem',
            width: 'calc(50% - 0.125rem)',
            transform: agentProfile === 'research' ? 'translateX(100%)' : 'translateX(0%)',
          }}
        />

        {PROFILE_OPTIONS.map((profile) => (
          <button
            key={profile.key}
            type="button"
            onClick={() => {
              if (!canSwitchAgentProfile) return
              setAgentProfile(profile.key)
            }}
            disabled={!canSwitchAgentProfile}
            className={cn(
              'relative z-10 w-16 py-1 text-xs font-medium rounded-full transition-colors',
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

  // We use callback-ref state (instead of useRef) so the effect below re-runs
  // whenever the underlying DOM nodes change — e.g. if the component briefly
  // takes the "no task" branch and remounts these divs. With useRef the
  // effect would only fire once on mount and the captured closure could
  // outlive the elements it observes.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [fixedEl, setFixedEl] = useState<HTMLDivElement | null>(null)
  // `null` = no room for the question; a number = px budget for the question.
  const [questionBudget, setQuestionBudget] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!containerEl || !fixedEl) return

    const update = () => {
      const containerRect = containerEl.getBoundingClientRect()
      const style = getComputedStyle(containerEl)
      const paddingLeft = parseFloat(style.paddingLeft) || 0
      const paddingRight = parseFloat(style.paddingRight) || 0
      // scrollWidth always reports the natural width of fixedEl's contents
      // even if flexbox shrinks the box (which it shouldn't, given the
      // shrink-0 on the wrapper, but we measure defensively).
      const fixedNaturalWidth = fixedEl.scrollWidth
      const innerWidth = containerRect.width - paddingLeft - paddingRight
      const available = innerWidth - fixedNaturalWidth - QUESTION_GAP_PX
      setQuestionBudget(
        available < MIN_QUESTION_PX
          ? null
          : Math.min(MAX_QUESTION_PX, available),
      )
    }

    update()

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(containerEl)
      ro.observe(fixedEl)
    }
    // Always listen to `window.resize` as a backup. Some Chromium page-zoom
    // paths change clientWidth without firing ResizeObserver on observed
    // elements that haven't *themselves* changed size (and our shrink-0
    // wrapper deliberately doesn't change size). Without this listener the
    // question would never reappear after a zoom-back.
    window.addEventListener('resize', update)

    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerEl, fixedEl])

  // Quick Chat: a minimal toolbar — no project profile / stage / contract UI.
  if (appMode === 'normal') {
    return (
      <div className="flex items-center gap-3 py-2.5 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        {toolButtons}
        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
        <span className="text-xs text-[var(--color-text-muted)]">{t('normalChatTitle', lang)}</span>
      </div>
    )
  }

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
    <div
      ref={setContainerEl}
      className="flex items-center py-2 px-6 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]"
    >
      <div ref={setFixedEl} className="flex items-center gap-3 shrink-0">
        {toolButtons}
        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
        {agentProfileSlider}
        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
        <div
          className={cn(
            'flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-0.5 shrink-0',
            !canSwitchContractVersion && 'opacity-60',
          )}
          title={!canSwitchContractVersion ? t('contractSwitchManualOnly', lang) : undefined}
        >
          {CONTRACT_MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={!canSwitchContractVersion}
              onClick={() => {
                if (!canSwitchContractVersion) return
                setContractVersion(item.key)
              }}
              className={cn(
                'px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                effectiveContractVersion === item.key
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                !canSwitchContractVersion && 'cursor-not-allowed',
              )}
            >
              {t(item.labelKey, lang)}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />

        {/* Stage tabs — shrink-0 so the buttons keep their natural width and
            never overflow into the coreQuestion area. */}
        <div className="flex items-center gap-0.5 shrink-0">
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
                  <span>{t(stage.labelKey, lang)}</span>
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
      </div>

      {/* Core question — only rendered when the row has ≥ MIN_QUESTION_PX of
          slack to its right (issue #20). `ml-auto` pins it to the row's right
          edge; `pl-3` recreates the gap-3 spacing the wrapping div otherwise
          provided. Full text is always available via the title tooltip. The
          maxWidth is bound to the *measured* free space so the paragraph can
          never push past the row's right padding and overlap its neighbours. */}
      {task.coreQuestion && questionBudget != null && (
        <p
          className="ml-auto pl-3 text-[11px] text-[var(--color-text-muted)] truncate shrink-0"
          style={{ maxWidth: questionBudget }}
          title={task.coreQuestion}
        >
          {task.coreQuestion}
        </p>
      )}
    </div>
  )
}
