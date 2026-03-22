import { useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { QueueItem } from './QueueItem'
import { cn } from '@/lib/utils'

type Tab = 'in_progress' | 'completed'

export function ProjectQueue() {
  const { tasks, selectedTaskId, selectTask, mode, setMode } = useProjectStore()
  const [tab, setTab] = useState<Tab>('in_progress')

  const filtered = tasks.filter((t) =>
    tab === 'in_progress' ? t.status === 'in_progress' : t.status === 'completed',
  )

  return (
    <aside className="flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)]">
        {(['in_progress', 'completed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors',
              tab === t
                ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            {t === 'in_progress' ? 'In Progress' : 'Completed'}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.map((task) => (
          <QueueItem
            key={task.id}
            task={task}
            isSelected={task.id === selectedTaskId}
            onSelect={selectTask}
          />
        ))}
      </div>

      {/* Mode switch */}
      <div className="p-3 border-t border-[var(--color-border)] flex items-center gap-2">
        {(['manual', 'auto'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors capitalize',
              mode === m
                ? m === 'auto'
                  ? 'bg-[var(--color-success)] text-white'
                  : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            {m === 'manual' ? '● Manual' : '● Auto'}
          </button>
        ))}
      </div>
    </aside>
  )
}
