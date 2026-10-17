import { useEffect, useRef, useState } from 'react'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { useUiStore } from '@/stores/uiStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const EMPTY: string[] = []

/**
 * Chooses which knowledge bases the agent may search. In a project the choice
 * is saved on the project (shared by all its conversations); in Quick Chat it
 * is remembered per chat and sent with each message.
 */
export function KnowledgePicker({
  sessionId,
  scope,
  lang,
  disabled,
}: {
  sessionId: string | null
  scope: 'project' | 'chat'
  lang: ReturnType<typeof useSettingsStore.getState>['language']
  disabled?: boolean
}) {
  const bases = useKnowledgeStore((s) => s.bases)
  const loaded = useKnowledgeStore((s) => s.loaded)
  const loadBases = useKnowledgeStore((s) => s.loadBases)
  const loadProjectBases = useKnowledgeStore((s) => s.loadProjectBases)
  const setProjectBases = useKnowledgeStore((s) => s.setProjectBases)
  const setChatBases = useKnowledgeStore((s) => s.setChatBases)
  const selected = useKnowledgeStore((s) => {
    if (!sessionId) return EMPTY
    return (scope === 'project' ? s.projectBases[sessionId] : s.chatBases[sessionId]) ?? EMPTY
  })
  const openKnowledge = useUiStore((s) => s.openKnowledge)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loaded) void loadBases()
  }, [loaded, loadBases])

  useEffect(() => {
    if (scope === 'project' && sessionId) void loadProjectBases(sessionId)
  }, [scope, sessionId, loadProjectBases])

  useEffect(() => {
    setOpen(false)
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Hide bases that were deleted elsewhere.
  const known = new Set(bases.map((b) => b.id))
  const active = loaded ? selected.filter((id) => known.has(id)) : selected
  const names = bases.filter((b) => active.includes(b.id)).map((b) => b.name)

  const toggle = (kbId: string) => {
    if (!sessionId) return
    const next = active.includes(kbId) ? active.filter((id) => id !== kbId) : [...active, kbId]
    if (scope === 'project') void setProjectBases(sessionId, next)
    else setChatBases(sessionId, next)
  }

  return (
    <div ref={rootRef} className="relative self-end">
      <button
        type="button"
        disabled={!sessionId || disabled}
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void loadBases()
        }}
        className={cn(
          'h-10 rounded-lg border px-2 text-sm hover:bg-[var(--color-bg-hover)] disabled:opacity-50',
          active.length
            ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)]'
            : 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
        )}
        title={names.length ? names.join(', ') : t('knowledgePicker', lang)}
        aria-label={t('knowledgePicker', lang)}
        aria-expanded={open}
      >
        📚{active.length > 0 && <span className="ml-1 text-xs">{active.length}</span>}
      </button>
      {open && (
        <div className="absolute bottom-12 left-0 z-30 w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 shadow-xl">
          <p className="px-2 pb-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
            {t(scope === 'project' ? 'knowledgePickerProject' : 'knowledgePickerChat', lang)}
          </p>
          <div className="max-h-56 overflow-y-auto">
            {bases.length === 0 ? (
              <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">{t('knowledgePickerEmpty', lang)}</p>
            ) : bases.map((kb) => (
              <label
                key={kb.id}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-bg-hover)]"
              >
                <input
                  type="checkbox"
                  checked={active.includes(kb.id)}
                  onChange={() => toggle(kb.id)}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-[var(--color-text-primary)]">{kb.name}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">
                    {t('knowledgeStats', lang, { sources: kb.sources, chunks: kb.chunks })}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              openKnowledge()
            }}
            className="mt-1 w-full rounded border-t border-[var(--color-border)] px-2 pt-2 pb-1 text-left text-xs text-[var(--color-accent)] hover:underline"
          >
            {t('knowledgeManage', lang)}
          </button>
        </div>
      )}
    </div>
  )
}
