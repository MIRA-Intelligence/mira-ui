import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { ChatThread } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface ChatItemProps {
  chat: ChatThread
  isSelected: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

interface MenuPos { x: number; y: number }

export function ChatItem({ chat, isSelected, onSelect, onRename, onDelete }: ChatItemProps) {
  const lang = useSettingsStore((s) => s.language)
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const label = chat.title || t('untitledChat', lang)

  const handleContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== chat.title) onRename(chat.id, trimmed)
    else setDraft(chat.title)
    setEditing(false)
  }

  const actions: { label: string; action: () => void; danger?: boolean }[] = [
    { label: t('rename', lang), action: () => { setMenu(null); setDraft(chat.title); setEditing(true) } },
    { label: t('delete', lang), action: () => { setMenu(null); onDelete(chat.id) }, danger: true },
  ]

  return (
    <>
      <button
        onClick={() => onSelect(chat.id)}
        onContextMenu={handleContext}
        className={cn(
          'w-full px-3 py-2 text-left rounded-md text-sm transition-colors select-none flex items-center gap-2',
          isSelected
            ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-accent)]/40'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-accent)]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(chat.title); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent border-b border-[var(--color-accent)] outline-none text-sm text-[var(--color-text-primary)]"
          />
        ) : (
          <span className="truncate">{label}</span>
        )}
      </button>

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
    </>
  )
}
