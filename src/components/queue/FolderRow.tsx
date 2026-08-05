import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface FolderRowProps {
  name: string
  count: number
  expanded: boolean
  virtual?: boolean
  mutable?: boolean
  onToggle: () => void
  onRename?: (name: string) => void
  onDelete?: () => void
  onDropItem: (event: React.DragEvent) => void
}

interface MenuPos { x: number; y: number }

export function FolderRow({
  name,
  count,
  expanded,
  virtual = false,
  mutable = true,
  onToggle,
  onRename,
  onDelete,
  onDropItem,
}: FolderRowProps) {
  const lang = useSettingsStore((state) => state.language)
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleContext = useCallback((event: React.MouseEvent) => {
    if (virtual || !mutable) return
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY })
  }, [mutable, virtual])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const commitRename = () => {
    const next = draft.trim()
    if (next && next !== name) onRename?.(next)
    else setDraft(name)
    setEditing(false)
  }

  return (
    <>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          setDragOver(false)
          onDropItem(event)
        }}
        className={cn(
          'group flex items-center rounded-md text-xs font-medium text-[var(--color-text-secondary)]',
          dragOver && 'bg-[var(--color-accent)]/15 ring-1 ring-[var(--color-accent)]/50',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          onContextMenu={handleContext}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left hover:text-[var(--color-text-primary)]"
          aria-expanded={expanded}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.3 1.5H16A1.5 1.5 0 0 1 17.5 7v7A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14V5.5Z" opacity=".85" />
          </svg>
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              maxLength={60}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') { setDraft(name); setEditing(false) }
              }}
              onClick={(event) => event.stopPropagation()}
              className="min-w-0 flex-1 border-b border-[var(--color-accent)] bg-transparent outline-none"
            />
          ) : (
            <span className="truncate">{name}</span>
          )}
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{count}</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
            aria-hidden="true"
          >
            <path d="m7 4 6 6-6 6" />
          </svg>
        </button>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[150px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={() => { setMenu(null); setDraft(name); setEditing(true) }}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-bg-hover)]"
          >
            {t('renameFolder', lang)}
          </button>
          <button
            type="button"
            onClick={() => { setMenu(null); onDelete?.() }}
            className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--color-bg-hover)]"
          >
            {t('deleteFolder', lang)}
          </button>
        </div>
      )}
    </>
  )
}
