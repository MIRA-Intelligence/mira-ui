import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { ProjectTask } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import type { OrganizationFolder } from '@/services/api'

interface QueueItemProps {
  task: ProjectTask
  isSelected: boolean
  onSelect: (id: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string, deleteFiles: boolean) => void
  onDuplicate: (id: string) => void
  folders?: OrganizationFolder[]
  currentFolderId?: string | null
  onMove?: (id: string, folderId: string | null) => void
}

interface MenuPos { x: number; y: number }

export function QueueItem({ task, isSelected, onSelect, onRename, onDelete, onDuplicate, folders = [], currentFolderId, onMove }: QueueItemProps) {
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
          'w-full px-3 py-2.5 text-left rounded-md text-sm font-mono transition-colors select-none flex items-center justify-between',
          isSelected
            ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-accent)]/40'
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
          <>
            <span className="truncate">{task.label}</span>
            {isCompleted && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 ml-2 text-[var(--color-text-muted)] opacity-60 shrink-0">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            )}
          </>
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
          {onMove && (
            <>
              <div className="my-1 border-t border-[var(--color-border)]" />
              <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('moveToFolder', lang)}
              </p>
              {[{ id: null, name: t('uncategorized', lang) }, ...folders].map((folder) => (
                <button
                  key={folder.id ?? '__uncategorized__'}
                  type="button"
                  disabled={(currentFolderId ?? null) === folder.id}
                  onClick={() => { setMenu(null); onMove(task.id, folder.id) }}
                  className="w-full truncate px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
                >
                  {folder.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl p-5 w-[320px]"
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
