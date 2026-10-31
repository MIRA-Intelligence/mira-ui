import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function isMacDesktop(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
}

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties

/**
 * Shell for overlays that cover the whole window, TopBar included.
 *
 * On macOS the window uses a hiddenInset title bar: the TopBar is an Electron
 * drag region, and drag regions swallow clicks regardless of z-index, while
 * the traffic lights sit over the top-left corner. So on macOS the page starts
 * with a strip that holds the traffic lights and keeps the window draggable,
 * and everything below it opts out of the drag region. Windows and Linux keep
 * the native title bar (hiddenInset is macOS-only), so nothing is added there.
 */
export function FullScreenPage({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const mac = isMacDesktop()
  return (
    <div {...props} className={cn('fixed inset-0 flex flex-col', className)}>
      {mac && <div data-testid="title-bar-strip" data-drag-region="drag" className="h-8 shrink-0" style={dragStyle} />}
      <div data-drag-region={mac ? 'no-drag' : undefined} className="flex flex-1 min-h-0 flex-col">
        {children}
      </div>
    </div>
  )
}
