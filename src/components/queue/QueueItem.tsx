import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { ProjectTask } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface QueueItemProps {
  task: ProjectTask
  isSelected: boolean
  onSelect: (id: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string, deleteFiles: boolean) => void
  onDuplicate: (id: string) => void
}

interface MenuPos { x: number; y: number }

export function QueueItem({ task, isSelected, onSelect, onRename, onDelete, onDuplicate }: QueueItemProps) {
  const lang = useSettingsStore((s) => s.language)
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState(task.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isCompleted = task.status === 'completed'

  const handleContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== task.label) onRename(task.id, trimmed)
    else setDraft(task.label)
    setEditing(false)
  }

  const actions: { label: string; action: () => void; danger?: boolean }[] = [
    { label: t('rename', lang), action: () => { setMenu(null); setEditing(true) } },
    { label: t('duplicate', lang), action: () => { setMenu(null); onDuplicate(task.id) } },
    { label: t('delete', lang), action: () => { setMenu(null); setConfirmDelete(true) }, danger: true },
  ]

  return (
    <>
      <button
        onClick={() => onSelect(task.id)}
        onContextMenu={handleContext}
        className={cn(
          'w-full px-3 py-2.5 text-left rounded-md text-sm font-mono transition-colors select-none',
          isSelected
            ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-accent)]/40'
            : isCompleted
              ? 'text-[var(--color-text-muted)]/50 hover:bg-[var(--color-bg-hover)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
        )}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(task.label); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent border-b border-[var(--color-accent)] outline-none text-sm font-mono text-[var(--color-text-primary)]"
          />
        ) : (
          task.label
        )}
      </button>

      {/* Context menu — portal to body via fixed positioning */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-md shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.action}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] transition-colors',
                a.danger ? 'text-red-400' : 'text-[var(--color-text-secondary)]',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl p-5 w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
              {t('deleteProjectTitle', lang, { name: task.label })}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] mb-4 leading-relaxed">
              {t('deleteProjectDesc', lang)}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setConfirmDelete(false); onDelete(task.id, true) }}
                className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                {t('deleteUiAndFiles', lang)}
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(task.id, false) }}
                className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                {t('removeUiKeepFiles', lang)}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="w-full px-3 py-2 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                {t('cancel', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
