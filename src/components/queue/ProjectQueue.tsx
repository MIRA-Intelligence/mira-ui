import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Language } from '@/stores/settingsStore'
import { wsClient } from '@/services/websocket'
import type { Stats } from '@/types'
import { QueueItem } from './QueueItem'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const MODE_SWITCH_POLL_INTERVAL_MS = 1000
const MODE_SWITCH_POLL_TIMEOUT_MS = 20000

export function ProjectQueue() {
  const {
    tasks,
    appMode,
    selectedTaskId,
    selectTask,
    mode,
    setMode,
    renameTask,
    deleteTask,
    duplicateTask,
    refreshPlan,
    stats,
  } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)
  const modePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modePollDeadlineRef = useRef<number>(0)

  const handleDelete = (id: string, deleteFiles: boolean) => {
    deleteTask(id, deleteFiles)
  }
  const { openNewProject } = useUiStore()

  const stopModePoll = () => {
    if (!modePollRef.current) return
    clearInterval(modePollRef.current)
    modePollRef.current = null
  }

  const startModeSyncPolling = (sessionId: string) => {
    stopModePoll()
    modePollDeadlineRef.current = Date.now() + MODE_SWITCH_POLL_TIMEOUT_MS

    const tick = async () => {
      await useProjectStore.getState().refreshPlan(sessionId)
      const task = useProjectStore.getState().tasks.find((t) => t.id === sessionId)
      const hasRunningExperiment = !!task?.experiments.some((e) => e.status === 'running')
      const timedOut = Date.now() >= modePollDeadlineRef.current
      if (!hasRunningExperiment || timedOut) {
        stopModePoll()
      }
    }

    void tick()
    modePollRef.current = setInterval(() => {
      void tick()
    }, MODE_SWITCH_POLL_INTERVAL_MS)
  }

  const handleModeSwitch = (nextMode: 'manual' | 'auto') => {
    if (appMode === 'normal') return
    if (mode === nextMode) return
    setMode(nextMode)
    if (!selectedTaskId) return

    wsClient.send({
      type: 'set_mode',
      content: '',
      session_id: selectedTaskId,
      user_id: 'ui_user',
      mode: nextMode,
    })

    void refreshPlan(selectedTaskId)
    startModeSyncPolling(selectedTaskId)
  }

  useEffect(() => () => stopModePoll(), [])
  const isAutoMode = mode === 'auto'

  return (
    <aside className="flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          {t('projects', lang)}
        </span>
        <button
          onClick={openNewProject}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label={t('newProjectAria', lang)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <QueueStatsBar stats={stats} taskCount={tasks.length} lang={lang} />

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {tasks.map((task) => (
          <QueueItem
            key={task.id}
            task={task}
            isSelected={task.id === selectedTaskId}
            onSelect={selectTask}
            onRename={renameTask}
            onDelete={handleDelete}
            onDuplicate={duplicateTask}
          />
        ))}
      </div>

      {appMode === 'project' && (
        <div className="p-3 border-t border-[var(--color-border)] flex items-center justify-center">
          <div className="relative w-full max-w-[220px] rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1">
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute left-1 top-1 bottom-1 rounded-full transition-transform duration-200 ease-out',
                isAutoMode ? 'bg-[var(--color-success)]' : 'bg-[var(--color-accent)]',
              )}
              style={{
                width: 'calc(50% - 0.25rem)',
                transform: isAutoMode ? 'translateX(100%)' : 'translateX(0%)',
              }}
            />

            <div className="relative z-10 grid grid-cols-2">
              {(['manual', 'auto'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSwitch(m)}
                  className={cn(
                    'py-1.5 text-xs font-medium rounded-full transition-colors',
                    mode === m ? 'text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {t(m, lang)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function QueueStatsBar({
  stats,
  taskCount,
  lang,
}: {
  stats: Stats
  taskCount: number
  lang: Language
}) {
  if (taskCount === 0 && stats.experiments === 0) return null

  const totalKey = taskCount === 1 ? 'queueSummaryTotal' : 'queueSummaryTotalPlural'

  return (
    <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/30 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)] tabular-nums">
      <span>{t(totalKey, lang, { count: taskCount })}</span>
      {stats.experiments > 0 && (
        <>
          <span aria-hidden className="text-[var(--color-text-muted)]/50">·</span>
          <span title={t('experiments', lang)}>
            <span className="text-[var(--color-text-secondary)] font-medium">{stats.completed}</span>
            <span className="opacity-60">/{stats.experiments}</span>
            <span className="ml-1 opacity-70">{t('experiment', lang)}</span>
          </span>
        </>
      )}
      {stats.running > 0 && (
        <span className="flex items-center gap-1 text-[var(--color-accent)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" aria-hidden />
          {t('queueSummaryRunning', lang, { count: stats.running })}
        </span>
      )}
      {stats.failed > 0 && (
        <span className="flex items-center gap-1 text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" aria-hidden />
          {t('queueSummaryFailed', lang, { count: stats.failed })}
        </span>
      )}
    </div>
  )
}
