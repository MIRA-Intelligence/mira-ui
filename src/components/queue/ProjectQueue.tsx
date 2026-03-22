import { useProjectStore } from '@/stores/projectStore'
import { QueueItem } from './QueueItem'
import { cn } from '@/lib/utils'

export function ProjectQueue() {
  const { tasks, selectedTaskId, selectTask, mode, setMode, renameTask, deleteTask, duplicateTask } = useProjectStore()

  return (
    <aside className="flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--color-border)]">
        <span className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Projects
        </span>
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
            onDelete={deleteTask}
            onDuplicate={duplicateTask}
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
