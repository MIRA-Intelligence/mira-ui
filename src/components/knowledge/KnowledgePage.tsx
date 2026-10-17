import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { isIngesting, useKnowledgeStore } from '@/stores/knowledgeStore'
import {
  searchKnowledgeBase,
  type KnowledgeBaseDetail,
  type KnowledgeHit,
  type KnowledgeSource,
  type KnowledgeSourceStatus,
} from '@/services/knowledge'
import { t, type I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']
type SourceTab = 'files' | 'url' | 'git' | 'dir'

const POLL_MS = 2000
// Sentinel selection for the "new knowledge base" form.
const NEW_KB = '__new__'

const inputClass =
  'w-full h-9 bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]'
const primaryButton =
  'px-3 h-9 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium transition-colors hover:bg-[var(--color-accent)]/80 disabled:opacity-50 disabled:cursor-not-allowed'
const ghostButton =
  'px-2 py-1 text-xs rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50'

const STATUS_STYLE: Record<KnowledgeSourceStatus, { key: I18nKey; className: string }> = {
  pending: { key: 'knowledgeStatusPending', className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]' },
  processing: { key: 'knowledgeStatusProcessing', className: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' },
  ready: { key: 'knowledgeStatusReady', className: 'bg-[var(--color-success)]/15 text-[var(--color-success)]' },
  failed: { key: 'knowledgeStatusFailed', className: 'bg-red-500/15 text-red-400' },
}

const KIND_ICON: Record<KnowledgeSource['kind'], string> = {
  file: '📄',
  archive: '🗜',
  url: '🌐',
  git: '⎇',
  dir: '📁',
}

export function KnowledgePage() {
  const open = useUiStore((s) => s.knowledgeOpen)
  const close = useUiStore((s) => s.closeKnowledge)
  const lang = useSettingsStore((s) => s.language)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const { bases, details, loaded, error, clearError, loadBases, loadDetail } = useKnowledgeStore()
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    clearError()
    void loadBases()
  }, [open, apiUrl, loadBases, clearError])

  // Default to the first base once the list arrives; drop a selection that vanished.
  useEffect(() => {
    if (!open || !loaded) return
    if (selected === NEW_KB) return
    if (selected && bases.some((b) => b.id === selected)) return
    setSelected(bases[0]?.id ?? (bases.length === 0 ? NEW_KB : null))
  }, [open, loaded, bases, selected])

  useEffect(() => {
    if (open && selected && selected !== NEW_KB) void loadDetail(selected)
  }, [open, selected, loadDetail])

  if (!open) return null

  const detail = selected && selected !== NEW_KB ? details[selected] : undefined

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('knowledgeBases', lang)}</h2>
        <button
          onClick={close}
          aria-label={t('cancel', lang)}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {error && (
        <div role="alert" className="mx-6 mt-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label={t('cancel', lang)} className="leading-none">✕</button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
          <div className="p-3 border-b border-[var(--color-border)]">
            <button type="button" onClick={() => setSelected(NEW_KB)} className={cn(primaryButton, 'w-full')}>
              + {t('knowledgeNew', lang)}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loaded && bases.length === 0 && (
              <p className="px-2 py-3 text-xs text-[var(--color-text-muted)]">{t('knowledgeEmpty', lang)}</p>
            )}
            {bases.map((kb) => (
              <button
                key={kb.id}
                type="button"
                onClick={() => setSelected(kb.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors',
                  selected === kb.id ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-hover)]/60',
                )}
              >
                <div className="text-sm text-[var(--color-text-primary)] truncate">{kb.name}</div>
                <div className="text-[11px] text-[var(--color-text-muted)]">
                  {t('knowledgeStats', lang, { sources: kb.sources, chunks: kb.chunks })}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {selected === NEW_KB ? (
            <NewKnowledgeBaseForm
              lang={lang}
              onCreated={setSelected}
              onCancel={bases.length ? () => setSelected(bases[0].id) : undefined}
            />
          ) : detail ? (
            <KnowledgeBaseView key={detail.id} detail={detail} lang={lang} />
          ) : (
            <p className="p-8 text-sm text-[var(--color-text-muted)]">{t('knowledgeSelectHint', lang)}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function NewKnowledgeBaseForm({
  lang,
  onCreated,
  onCancel,
}: {
  lang: Lang
  onCreated: (id: string) => void
  onCancel?: () => void
}) {
  const create = useKnowledgeStore((s) => s.create)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    const id = await create(name.trim(), description.trim())
    setBusy(false)
    if (id) onCreated(id)
  }

  return (
    <div className="max-w-2xl p-8 space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('knowledgeNew', lang)}</h3>
      <label className="block space-y-1">
        <span className="text-xs text-[var(--color-text-secondary)]">{t('knowledgeName', lang)}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('knowledgeNamePlaceholder', lang)}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-[var(--color-text-secondary)]">{t('knowledgeDescription', lang)}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('knowledgeDescriptionPlaceholder', lang)}
          rows={3}
          className={cn(inputClass, 'h-auto py-2 resize-y')}
        />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={!name.trim() || busy} onClick={() => void submit()} className={primaryButton}>
          {t('knowledgeCreate', lang)}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={cn(ghostButton, 'h-9 px-3 text-sm')}>
            {t('cancel', lang)}
          </button>
        )}
      </div>
    </div>
  )
}

function KnowledgeBaseView({ detail, lang }: { detail: KnowledgeBaseDetail; lang: Lang }) {
  const { update, remove, loadDetail, loadBases } = useKnowledgeStore()
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const ingesting = isIngesting(detail)

  // Poll while sources are queued or indexing so status badges stay live.
  useEffect(() => {
    if (!ingesting) return
    const id = setInterval(() => {
      void loadDetail(detail.id)
      void loadBases()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [ingesting, detail.id, loadDetail, loadBases])

  const dirty = name.trim() !== detail.name || description.trim() !== detail.description

  return (
    <div className="max-w-4xl p-8 space-y-8">
      <section className="space-y-3">
        <input
          aria-label={t('knowledgeName', lang)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cn(inputClass, 'text-base font-semibold')}
        />
        <textarea
          aria-label={t('knowledgeDescription', lang)}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('knowledgeDescriptionPlaceholder', lang)}
          rows={2}
          className={cn(inputClass, 'h-auto py-2 resize-y')}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || !name.trim()}
            onClick={() => void update(detail.id, { name: name.trim(), description: description.trim() })}
            className={primaryButton}
          >
            {t('save', lang)}
          </button>
          <span className="text-xs text-[var(--color-text-muted)]">
            {t('knowledgeStats', lang, { sources: detail.sources.length, chunks: detail.chunks })}
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('knowledgeDeleteConfirm', lang, { name: detail.name }))) void remove(detail.id)
            }}
            className="ml-auto px-3 h-9 text-sm rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
          >
            {t('knowledgeDelete', lang)}
          </button>
        </div>
      </section>

      <AddSources kbId={detail.id} lang={lang} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('knowledgeSources', lang)}</h3>
        {detail.sources.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">{t('knowledgeNoSources', lang)}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {detail.sources.map((source) => (
              <SourceRow key={source.id} kbId={detail.id} source={source} lang={lang} />
            ))}
          </ul>
        )}
      </section>

      <TestSearch kbId={detail.id} lang={lang} />
    </div>
  )
}

function SourceRow({ kbId, source, lang }: { kbId: string; source: KnowledgeSource; lang: Lang }) {
  const { refreshSource, removeSource } = useKnowledgeStore()
  const status = STATUS_STYLE[source.status] ?? STATUS_STYLE.pending
  const busy = source.status === 'pending' || source.status === 'processing'
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span aria-hidden className="mt-0.5 w-5 text-center">{KIND_ICON[source.kind] ?? '📄'}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-[var(--color-text-primary)]" title={source.origin}>{source.title}</div>
        {source.status === 'failed' ? (
          <div className="text-xs text-red-400 break-words">{source.error}</div>
        ) : source.status === 'ready' ? (
          <div className="text-xs text-[var(--color-text-muted)]">
            {t('knowledgeSourceCounts', lang, { docs: source.doc_count, chunks: source.chunk_count })}
          </div>
        ) : null}
      </div>
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', status.className)}>{t(status.key, lang)}</span>
      <button type="button" disabled={busy} onClick={() => void refreshSource(kbId, source.id)} className={ghostButton}>
        {t('knowledgeRefresh', lang)}
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('knowledgeRemoveSourceConfirm', lang, { title: source.title }))) {
            void removeSource(kbId, source.id)
          }
        }}
        className={cn(ghostButton, 'text-red-400')}
      >
        {t('knowledgeRemoveSource', lang)}
      </button>
    </li>
  )
}

function AddSources({ kbId, lang }: { kbId: string; lang: Lang }) {
  const { upload, addSource } = useKnowledgeStore()
  const [tab, setTab] = useState<SourceTab>('files')
  const [value, setValue] = useState('')
  const [gitRef, setGitRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    if (ok) {
      setValue('')
      setGitRef('')
    }
  }

  const uploadFiles = (files: FileList | null) => {
    const list = files ? Array.from(files) : []
    if (list.length) void run(() => upload(kbId, list))
  }

  const submit = () => {
    const text = value.trim()
    if (!text) return
    if (tab === 'url') void run(() => addSource(kbId, { type: 'url', url: text }))
    if (tab === 'git') void run(() => addSource(kbId, { type: 'git', url: text, ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) }))
    if (tab === 'dir') void run(() => addSource(kbId, { type: 'dir', path: text }))
  }

  const tabs: [SourceTab, I18nKey][] = [
    ['files', 'knowledgeTabFiles'],
    ['url', 'knowledgeTabUrl'],
    ['git', 'knowledgeTabGit'],
    ['dir', 'knowledgeTabDir'],
  ]
  const placeholder: Record<Exclude<SourceTab, 'files'>, I18nKey> = {
    url: 'knowledgeUrlPlaceholder',
    git: 'knowledgeGitPlaceholder',
    dir: 'knowledgeDirPlaceholder',
  }

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setDragging(false)
    uploadFiles(e.dataTransfer.files)
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('knowledgeAddSources', lang)}</h3>
      <div role="tablist" className="flex gap-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key)
              setValue('')
            }}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors',
              tab === key
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
            )}
          >
            {t(label, lang)}
          </button>
        ))}
      </div>
      {tab === 'files' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'w-full rounded-lg border-2 border-dashed px-4 py-8 text-sm text-[var(--color-text-muted)] transition-colors',
              dragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/60',
            )}
          >
            {busy ? t('knowledgeUploading', lang) : t('knowledgeDropHint', lang)}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="knowledge-file-input"
            onChange={(e) => {
              uploadFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
              }}
              placeholder={t(placeholder[tab], lang)}
              className={inputClass}
            />
            {tab === 'git' && (
              <input
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
                placeholder={t('knowledgeGitRef', lang)}
                className={cn(inputClass, 'w-48 shrink-0')}
              />
            )}
            <button type="button" disabled={busy || !value.trim()} onClick={submit} className={cn(primaryButton, 'shrink-0')}>
              {t('knowledgeAdd', lang)}
            </button>
          </div>
          {tab === 'dir' && <p className="text-xs text-[var(--color-text-muted)]">{t('knowledgeDirHint', lang)}</p>}
        </div>
      )}
    </section>
  )
}

function TestSearch({ kbId, lang }: { kbId: string; lang: Lang }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      setHits(await searchKnowledgeBase(kbId, query.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('knowledgeTestSearch', lang)}</h3>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void search()
          }}
          placeholder={t('knowledgeSearchPlaceholder', lang)}
          className={inputClass}
        />
        <button type="button" disabled={busy || !query.trim()} onClick={() => void search()} className={cn(primaryButton, 'shrink-0')}>
          {t('knowledgeSearch', lang)}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hits && hits.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">{t('knowledgeNoHits', lang)}</p>}
      {hits && hits.length > 0 && (
        <ol className="space-y-2">
          {hits.map((hit) => (
            <li key={`${hit.doc_id}:${hit.start_line}`} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-medium text-[var(--color-accent)]">{hit.citation}</span>
                <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">{hit.score.toFixed(2)}</span>
              </div>
              {hit.heading && <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{hit.heading}</div>}
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--color-text-secondary)] line-clamp-6">
                {hit.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
