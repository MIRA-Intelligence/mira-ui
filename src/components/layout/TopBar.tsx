import { useProjectStore } from '@/stores/projectStore'
import { useTimer } from '@/hooks/useTimer'
import { FeedbackButton } from '@/components/feedback/FeedbackButton'
import type { CSSProperties } from 'react'

export function TopBar() {
  const { tasks, selectedTaskId, startedAt } = useProjectStore()
  const { formatted } = useTimer(startedAt)
  const isMacDesktop = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const dragStyle = isMacDesktop ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined

  const selected = tasks.find((t) => t.id === selectedTaskId)
  const title = selected?.title ?? 'Mira'

  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]"
      data-drag-region={isMacDesktop ? 'drag' : 'none'}
      style={dragStyle}
    >
      <div className={isMacDesktop ? 'min-w-[220px]' : 'min-w-[140px]'} />

      <h1 className="text-lg font-semibold text-[var(--color-text-primary)] text-center flex-1 truncate">
        {title}
      </h1>

      <div className="flex items-center gap-3 min-w-[140px] justify-end">
        <FeedbackButton />
        <div className="font-mono text-xl tracking-wider text-[var(--color-text-secondary)] tabular-nums">
          T+ {formatted}
        </div>
      </div>
    </header>
  )
}
