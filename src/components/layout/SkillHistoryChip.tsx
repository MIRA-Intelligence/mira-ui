import { useEffect, useId, useRef, useState } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSkillHistoryStore } from '@/stores/skillHistoryStore'
import { t, type I18nKey } from '@/i18n'
import type { SkillLoadEvent } from '@/types'

const EMPTY_EVENTS: SkillLoadEvent[] = []
const EMPTY_IDS: string[] = []
const SOURCE_KEYS: Record<SkillLoadEvent['source'], I18nKey> = {
  manual: 'skillSourceManual', auto: 'skillSourceAuto', recent: 'skillSourceRecent',
  always: 'skillSourceAlways', read_file: 'skillSourceRead',
}
const STAGE_KEYS: Record<string, I18nKey> = {
  initiation: 'skillStageInitiation', planning: 'skillStagePlanning',
  experiment: 'skillStageExperiment', delivery: 'skillStageDelivery',
}

export function SkillHistoryChip({ sessionId }: { sessionId: string }) {
  const lang = useSettingsStore((s) => s.language)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const workspace = useSettingsStore((s) => s.workspacePath)
  const connected = useAgentStore((s) => s.connected)
  const events = useSkillHistoryStore((s) => s.events[sessionId] ?? EMPTY_EVENTS)
  const liveIds = useSkillHistoryStore((s) => s.liveIds[sessionId] ?? EMPTY_IDS)
  const loading = useSkillHistoryStore((s) => s.loading[sessionId] ?? false)
  const error = useSkillHistoryStore((s) => s.errors[sessionId])
  const cursor = useSkillHistoryStore((s) => s.cursors[sessionId])
  const load = useSkillHistoryStore((s) => s.load)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  const seen = useRef(new Set(liveIds))
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialogId = useId()

  useEffect(() => {
    if (connected) void load(sessionId)
  }, [sessionId, connected, apiUrl, workspace, load])

  useEffect(() => {
    const fresh = liveIds.filter((id) => !seen.current.has(id))
    seen.current = new Set(liveIds)
    if (fresh.length) setPending((queue) => [...queue, ...fresh])
  }, [liveIds])

  const head = pending[0]
  useEffect(() => {
    if (!head) return
    const timer = setTimeout(() => setPending((queue) => queue.filter((id) => id !== head)), 2500)
    return () => clearTimeout(timer)
  }, [head])

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const current = events.find((event) => event.id === head) ?? events[events.length - 1]
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const label = current ? `${t('skillLoaded', lang)} $${current.skill_name}` : t('skillNoLoads', lang)
  return (
    <div className="relative min-w-0 shrink flex items-stretch" ref={root}>
      <button ref={button} type="button" aria-label={t('skillLoadHistory', lang)}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen((value) => !value)} title={label}
        className="flex min-w-0 max-w-[280px] items-center gap-1.5 px-2 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">
        <span className={current ? 'text-emerald-500 shrink-0' : 'opacity-50 shrink-0'} aria-hidden>◇</span>
        <span className="truncate">{label}</span>
        {current && <time className="hidden sm:inline shrink-0 opacity-70" dateTime={current.loaded_at}>{new Date(current.loaded_at).toLocaleTimeString(locale, { hour12: false })}</time>}
        {events.length > 0 && <span className="shrink-0 opacity-60">({events.length}{cursor != null ? '+' : ''})</span>}
      </button>
      {open && (
        <section id={dialogId} role="dialog" aria-label={t('skillLoadHistory', lang)}
          className="absolute bottom-full left-0 z-50 mb-2 w-[380px] max-w-[85vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-xl text-[var(--color-text-primary)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <h2 className="text-sm font-medium">{t('skillLoadHistory', lang)}</h2>
            <button ref={closeButton} type="button" aria-label={t('skillHistoryClose', lang)} className="rounded px-2 py-1 hover:bg-[var(--color-bg-hover)]"
              onClick={() => { setOpen(false); button.current?.focus() }}>×</button>
          </div>
          <p className="px-3 py-2 text-xs text-[var(--color-text-muted)]">{t('skillLoadNote', lang)}</p>
          <div className="max-h-[min(360px,60vh)] overflow-y-auto px-3 pb-3">
            {error && <div className="mb-2 text-xs text-amber-500">{t('skillHistoryUnavailable', lang)} <button type="button" className="underline" onClick={() => void load(sessionId)}>{t('skillHistoryRetry', lang)}</button></div>}
            {!events.length && <p className="py-3 text-xs text-[var(--color-text-muted)]">{t(loading ? 'skillHistoryLoading' : 'skillNoLoads', lang)}</p>}
            <ol className="space-y-2">
              {[...events].reverse().map((event) => <li key={event.id} className="rounded border border-[var(--color-border)] px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium break-all">${event.skill_name}</span>
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{t(SOURCE_KEYS[event.source], lang)}</span>
                </div>
                <time className="mt-1 block text-[10px] text-[var(--color-text-muted)]" dateTime={event.loaded_at}>{new Date(event.loaded_at).toLocaleString(locale, { hour12: false })}</time>
                {(event.module_type || event.partial || event.agent) && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  {event.module_type && (STAGE_KEYS[event.module_type] ? t(STAGE_KEYS[event.module_type], lang) : event.module_type)}
                  {event.agent && ` · ${event.agent}`}
                  {event.partial && ` · ${t('skillPartialRead', lang)}`}
                </p>}
              </li>)}
            </ol>
            {cursor != null && <button type="button" disabled={loading} className="mt-3 w-full rounded border border-[var(--color-border)] py-1.5 text-xs disabled:opacity-50" onClick={() => void load(sessionId, true)}>{t(loading ? 'skillHistoryLoading' : 'skillHistoryMore', lang)}</button>}
          </div>
        </section>
      )}
    </div>
  )
}
