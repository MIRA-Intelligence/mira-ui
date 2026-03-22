import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import type { LogEntry as LogEntryType } from '@/types'

interface LogEntryProps {
  entry: LogEntryType
}

export function LogEntry({ entry }: LogEntryProps) {
  const [collapsed, setCollapsed] = useState(entry.collapsed ?? false)

  if (entry.type === 'tool_call') {
    return (
      <div className="px-4 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <span>{collapsed ? '▷' : '▽'}</span>
          <span>Worked for &lt;1s</span>
        </button>
        {!collapsed && (
          <div className="mt-1 ml-4 flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-muted)]">🔧</span>
            <span className="px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] font-mono">
              {entry.content}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-2">
      <div className="text-xs text-[var(--color-text-muted)] mb-1 font-mono">
        {formatTime(entry.timestamp)}
      </div>
      <div
        className={cn(
          'text-sm leading-relaxed whitespace-pre-wrap',
          entry.type === 'error'
            ? 'text-red-400'
            : 'text-[var(--color-text-secondary)]',
        )}
      >
        {entry.content}
      </div>
    </div>
  )
}
