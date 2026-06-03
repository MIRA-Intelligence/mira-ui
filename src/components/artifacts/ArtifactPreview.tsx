import { useEffect, useState } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

import { CsvTable } from './CsvTable'
import { ImageLightbox } from './ImageLightbox'
import { JsonView } from './JsonView'
import { TextView } from './TextView'
import { detectArtifactKind, iconForKind, type ArtifactKind } from './detectKind'

interface ArtifactPreviewProps {
  path: string
  url: string
  // When false, the preview row is rendered as a static label with no
  // interactive buttons (matches the legacy "no project selected" state).
  enabled?: boolean
  disabledReason?: string
  // Default is the basename of `path`, displayed in the row label.
  label?: string
}

const KINDS_WITH_INLINE_BODY: ReadonlyArray<ArtifactKind> = [
  'image',
  'json',
  'csv',
  'tsv',
  'markdown',
  'text',
  'audio',
  'video',
]

const TEXT_LIKE: ReadonlyArray<ArtifactKind> = ['json', 'csv', 'tsv', 'markdown', 'text']

// Soft cap on the text length we'll fetch for inline preview. Larger files
// still get a "Download to view" affordance.
const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function ArtifactPreview({ path, url, enabled = true, disabledReason, label }: ArtifactPreviewProps) {
  const lang = useSettingsStore((s) => s.language)
  const kind = detectArtifactKind(path)
  const expandable = enabled && KINDS_WITH_INLINE_BODY.includes(kind)
  const [expanded, setExpanded] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const display = label ?? path

  const handleOpenOriginal = () => {
    if (!enabled) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleDownload = () => {
    if (!enabled) return
    const filename = path.split('/').filter(Boolean).pop() || 'artifact'
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-mono">
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setExpanded((v) => !v)}
          className="px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 max-w-full"
          title={!enabled ? disabledReason : expandable ? t('toggleArtifactPreview', lang) : t('artifactNotInlinePreviewable', lang)}
        >
          <span className="select-none">{expandable ? (expanded ? '▼' : '▷') : iconForKind(kind)}</span>
          <span className="truncate text-left">{display}</span>
        </button>
        <span className="ml-auto flex items-center gap-1">
          {kind === 'image' && enabled && (
            <IconButton
              onClick={() => setLightboxOpen(true)}
              title={t('viewImageFullSize', lang)}
              ariaLabel={t('viewImageFullSize', lang)}
            >
              ⤢
            </IconButton>
          )}
          <IconButton
            onClick={handleOpenOriginal}
            disabled={!enabled}
            title={t('openOriginalArtifact', lang)}
            ariaLabel={t('openOriginalArtifact', lang)}
          >
            ↗
          </IconButton>
          <IconButton
            onClick={handleDownload}
            disabled={!enabled}
            title={t('downloadArtifact', lang)}
            ariaLabel={t('downloadArtifact', lang)}
          >
            ⬇
          </IconButton>
        </span>
      </div>

      {expanded && enabled && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
          <PreviewBody
            kind={kind}
            path={path}
            url={url}
            onOpenLightbox={() => setLightboxOpen(true)}
          />
        </div>
      )}

      {lightboxOpen && enabled && (
        <ImageLightbox
          src={url}
          alt={display}
          onClose={() => setLightboxOpen(false)}
          onOpenOriginal={handleOpenOriginal}
          onDownload={handleDownload}
        />
      )}
    </div>
  )
}

function PreviewBody({
  kind,
  path,
  url,
  onOpenLightbox,
}: {
  kind: ArtifactKind
  path: string
  url: string
  onOpenLightbox: () => void
}) {
  const lang = useSettingsStore((s) => s.language)

  if (kind === 'image') {
    return (
      <button
        type="button"
        onClick={onOpenLightbox}
        className="block group"
        title={t('viewImageFullSize', lang)}
      >
        <img
          src={url}
          alt={path}
          loading="lazy"
          className="max-h-[360px] w-auto rounded-md border border-[var(--color-border)] group-hover:opacity-95 transition-opacity"
        />
      </button>
    )
  }

  if (kind === 'audio') {
    return <audio controls src={url} className="w-full" preload="metadata" />
  }
  if (kind === 'video') {
    return (
      <video
        controls
        src={url}
        className="max-h-[420px] w-full rounded-md bg-black"
        preload="metadata"
      />
    )
  }

  if (TEXT_LIKE.includes(kind)) {
    return <TextLikeBody kind={kind} path={path} url={url} />
  }

  return null
}

function TextLikeBody({ kind, path, url }: { kind: ArtifactKind; path: string; url: string }) {
  const lang = useSettingsStore((s) => s.language)
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ok'; text: string; truncated: boolean }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`)
        }
        const contentLength = Number(resp.headers.get('content-length') || '0')
        if (contentLength && contentLength > MAX_TEXT_BYTES) {
          if (!cancelled) {
            setState({
              status: 'error',
              message: t('artifactTooLargeToPreview', lang),
            })
          }
          return
        }
        const text = await resp.text()
        if (cancelled) return
        const truncated = text.length > MAX_TEXT_BYTES
        setState({
          status: 'ok',
          text: truncated ? text.slice(0, MAX_TEXT_BYTES) : text,
          truncated,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
  }, [url, lang])

  if (state.status === 'loading') {
    return <p className="text-xs text-[var(--color-text-muted)]">{t('artifactLoading', lang)}</p>
  }
  if (state.status === 'error') {
    return (
      <p className="text-xs text-[var(--color-error)]">
        {t('artifactLoadFailed', lang)}: {state.message}
      </p>
    )
  }

  const body = (() => {
    if (kind === 'json') return <JsonView text={state.text} />
    if (kind === 'csv') return <CsvTable text={state.text} delimiter="," />
    if (kind === 'tsv') return <CsvTable text={state.text} delimiter="\t" />
    return <TextView text={state.text} showLineNumbers={kind !== 'markdown'} />
  })()

  return (
    <div className="space-y-1">
      {body}
      {state.truncated && (
        <p className="text-[10px] text-[var(--color-warning)]">
          {t('artifactBodyTruncated', lang)}
        </p>
      )}
      <p className="text-[10px] text-[var(--color-text-muted)] truncate" title={path}>
        {path}
      </p>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title: string
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      className="px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[10px]"
    >
      {children}
    </button>
  )
}
