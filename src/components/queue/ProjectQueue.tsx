import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { wsClient } from '@/services/websocket'
import { QueueItem } from './QueueItem'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const MODE_SWITCH_POLL_INTERVAL_MS = 1000
const MODE_SWITCH_POLL_TIMEOUT_MS = 20000

export function ProjectQueue() {
  const {
    tasks,
    selectedTaskId,
    selectTask,
    mode,
    setMode,
    renameTask,
    deleteTask,
    duplicateTask,
    refreshPlan,
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

      {/* Mode switch */}
      <div className="p-3 border-t border-[var(--color-border)] flex items-center gap-2">
        {(['manual', 'auto'] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeSwitch(m)}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors capitalize',
              mode === m
                ? m === 'auto'
                  ? 'bg-[var(--color-success)] text-white'
                  : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            {m === 'manual' ? `● ${t('manual', lang)}` : `● ${t('auto', lang)}`}
          </button>
        ))}
      </div>
    </aside>
  )
}
