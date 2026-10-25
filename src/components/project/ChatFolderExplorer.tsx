import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { fetchChatWorkdir, fetchDirectory, uploadToFolder, type DirectoryListing } from '@/services/api'
import type { ProjectFileEntry, ProjectFileInfo } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { getFileIcon } from './fileIcons'

/** Parent of an absolute path on the engine's machine (POSIX or Windows). */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return null
  if (cut === 0) return trimmed.charAt(0)
  const parent = trimmed.slice(0, cut)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

function displayPath(path: string, home: string): string {
  if (!home || !path.startsWith(home)) return path
  const rest = path.slice(home.length)
  return rest === '' || rest.startsWith('/') || rest.startsWith('\\') ? `~${rest}` : path
}

function toEntry(file: ProjectFileInfo): ProjectFileEntry {
  return { ...file, projectId: '', relativePath: file.name, absolutePath: file.path }
}

type LoadError = { status: number; message: string }

/**
 * Quick Chat file browser. Opens the selected chat's folder (the agent's
 * working directory for that chat); the user can go up to browse other
 * folders, as far as the engine allows (their home).
 */
export function ChatFolderExplorer({ embedded = false }: { embedded?: boolean }) {
  const lang = useSettingsStore((s) => s.language)
  const workspacePath = useSettingsStore((s) => s.workspacePath)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const previewFile = useUiStore((s) => s.chatCenterPreviewFile)
  const setPreviewFile = useUiStore((s) => s.setChatCenterPreviewFile)
  const pushSystemMessage = useUiStore((s) => s.pushSystemMessage)

  const [chatFolder, setChatFolder] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [subfolders, setSubfolders] = useState<Record<string, ProjectFileInfo[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadInputId = useId()
  // Only the newest request may update the view, so a slow listing of the
  // previous folder cannot overwrite the current one.
  const loadSeq = useRef(0)
  const shownChatId = useRef(activeChatId)

  useEffect(() => {
    let cancelled = false
    // A preview from another chat's folder should not stay open.
    if (shownChatId.current !== activeChatId) setPreviewFile(null)
    shownChatId.current = activeChatId
    if (!activeChatId) {
      setChatFolder(null)
      setFolder(workspacePath.trim() || null)
      return
    }
    void fetchChatWorkdir(activeChatId).then((workdir) => {
      if (cancelled) return
      setChatFolder(workdir?.path ?? null)
      setFolder(workdir?.path ?? (workspacePath.trim() || null))
    })
    return () => {
      cancelled = true
    }
  }, [activeChatId, workspacePath, setPreviewFile])

  const loadSubfolder = useCallback(async (path: string) => {
    const result = await fetchDirectory(path)
    setSubfolders((current) => ({ ...current, [path]: result.ok ? result.listing.entries : [] }))
  }, [])

  const load = useCallback(async (keepExpanded: boolean) => {
    const seq = ++loadSeq.current
    if (!keepExpanded) {
      setExpanded(new Set())
      setSubfolders({})
      setSelected(null)
    }
    if (!folder) {
      setListing(null)
      setLoadError(null)
      return
    }
    setLoading(true)
    const result = await fetchDirectory(folder)
    if (seq !== loadSeq.current) return
    setLoading(false)
    if (result.ok) {
      setListing(result.listing)
      setLoadError(null)
    } else {
      setListing(null)
      setLoadError({ status: result.status, message: result.error ?? '' })
    }
  }, [folder])

  useEffect(() => {
    void load(false)
  }, [load])

  const refresh = () => {
    void load(true)
    expanded.forEach((path) => void loadSubfolder(path))
  }

  // Files added outside the explorer (e.g. the Quick Chat home page's upload).
  const chatFilesRevision = useUiStore((s) => s.chatFilesRevision)
  const seenRevision = useRef(chatFilesRevision)
  useEffect(() => {
    if (seenRevision.current === chatFilesRevision) return
    seenRevision.current = chatFilesRevision
    void load(true)
  }, [chatFilesRevision, load])

  const toggleFolder = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
      if (!subfolders[path]) void loadSubfolder(path)
    }
    setExpanded(next)
  }

  // Uploads go to the selected folder, the selected file's folder, or the folder shown.
  const uploadDir = selected
    ? (selected.isDir ? selected.path : parentPath(selected.path) ?? folder)
    : folder

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0 || !uploadDir) return
    setUploading(true)
    try {
      await uploadToFolder(uploadDir, files)
      pushSystemMessage(t('uploadedSuccessfully', lang), { severity: 'success' })
      if (uploadDir !== folder) {
        setExpanded((current) => new Set([...current, uploadDir]))
        void loadSubfolder(uploadDir)
      }
      // Re-lists this folder and anything else showing the chat's files (the home page).
      useUiStore.getState().bumpChatFiles()
    } catch (err: unknown) {
      pushSystemMessage(err instanceof Error ? err.message : t('uploadFailed', lang), { severity: 'error' })
    } finally {
      setUploading(false)
    }
  }

  const chatFolderMissing = loadError?.status === 404 && folder !== null && folder === chatFolder
  const upTarget = listing ? listing.parent : folder && loadError ? parentPath(folder) : null
  const home = listing?.home ?? ''
  const query = filter.trim().toLowerCase()

  const matches = (file: ProjectFileInfo): boolean => {
    if (!query || file.name.toLowerCase().includes(query)) return true
    return file.is_dir && (subfolders[file.path] ?? []).some(matches)
  }

  const renderRows = (files: ProjectFileInfo[], depth: number) => files.filter(matches).map((file) => {
    const isOpen = file.is_dir && (expanded.has(file.path) || (Boolean(query) && Boolean(subfolders[file.path])))
    const children = subfolders[file.path]
    return (
      <div key={file.path} className="select-none">
        <div
          onClick={() => {
            if (file.is_dir) toggleFolder(file.path)
            else setPreviewFile(toEntry(file))
            setSelected({ path: file.path, isDir: file.is_dir })
          }}
          onDoubleClick={() => {
            if (file.is_dir) setFolder(file.path)
          }}
          title={file.is_dir ? t('filesOpenFolderHint', lang) : file.name}
          className={cn(
            'group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors text-xs font-mono',
            previewFile?.absolutePath === file.path || (file.is_dir && selected?.path === file.path)
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {file.is_dir ? (
            <span
              className="w-3.5 h-3.5 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
            >
              ▶
            </span>
          ) : (
            <span className="w-3.5" />
          )}
          <span className="text-sm shrink-0">{file.is_dir ? '📁' : getFileIcon(file.name)}</span>
          <span className="truncate flex-1">{file.name}</span>
        </div>
        {isOpen && children && children.length > 0 && (
          <div className="mt-0.5">{renderRows(children, depth + 1)}</div>
        )}
      </div>
    )
  })

  const body = () => {
    if (loading && !listing) {
      return <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">{t('loading', lang)}</div>
    }
    if (chatFolderMissing) {
      return <p className="text-center py-8 px-4 text-xs text-[var(--color-text-muted)]">{t('filesChatFolderEmpty', lang)}</p>
    }
    if (loadError) {
      return (
        <div className="text-center py-8 px-4 space-y-2">
          <p className="text-xs text-amber-400/90 leading-snug">
            {loadError.status === 403
              ? t('filesFolderDenied', lang)
              : t('filesLoadFailed', lang, { status: loadError.status || '—', detail: loadError.message })}
          </p>
          <button type="button" onClick={refresh} className="text-xs text-[var(--color-accent)] hover:underline">
            {t('refreshFiles', lang)}
          </button>
        </div>
      )
    }
    if (!listing) return null
    if (listing.entries.length === 0) {
      return (
        <p className="text-center py-8 text-xs text-[var(--color-text-muted)]">
          {folder === chatFolder ? t('filesChatFolderEmpty', lang) : t('filesFolderEmpty', lang)}
        </p>
      )
    }
    return (
      <>
        <div className="space-y-0.5">{renderRows(listing.entries, 0)}</div>
        {listing.truncated && (
          <p className="px-2 pt-2 text-[10px] text-[var(--color-text-muted)]">{t('filesFolderTruncated', lang)}</p>
        )}
      </>
    )
  }

  const toolButton = 'p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-[var(--color-bg-secondary)] select-none',
        !embedded && 'border-r border-[var(--color-border)]',
      )}
    >
      <div className="px-2 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] space-y-1.5">
        {!embedded && (
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] block px-1">
            {t('filesTab', lang)}
          </span>
        )}
        <div className="flex items-center gap-0.5 min-w-0">
          <button
            type="button"
            onClick={() => upTarget && setFolder(upTarget)}
            disabled={!upTarget}
            className={toolButton}
            title={t('filesFolderUp', lang)}
            aria-label={t('filesFolderUp', lang)}
          >
            ↰
          </button>
          {chatFolder && folder !== chatFolder && (
            <button
              type="button"
              onClick={() => setFolder(chatFolder)}
              className={toolButton}
              title={t('filesOpenChatFolder', lang)}
              aria-label={t('filesOpenChatFolder', lang)}
            >
              ⌂
            </button>
          )}
          <span
            className="min-w-0 flex-1 px-1 text-[10px] font-mono truncate text-[var(--color-text-secondary)]"
            title={folder ?? undefined}
          >
            {folder ? displayPath(folder, home) : ''}
          </span>
          <label
            htmlFor={uploadInputId}
            className={cn(toolButton, 'cursor-pointer', (uploading || !uploadDir) && 'pointer-events-none opacity-40')}
            title={t('uploadFilesTo', lang, { folder: uploadDir ? displayPath(uploadDir, home) : '' })}
            aria-label={t('uploadFilesTo', lang, { folder: uploadDir ? displayPath(uploadDir, home) : '' })}
          >
            ↑
          </label>
          <input id={uploadInputId} type="file" multiple className="sr-only" onChange={(e) => void handleUpload(e)} />
          <button
            type="button"
            onClick={refresh}
            disabled={loading || !folder}
            className={cn(toolButton, loading && 'animate-spin opacity-70')}
            title={t('refreshFiles', lang)}
            aria-label={t('refreshFiles', lang)}
          >
            ↻
          </button>
        </div>
        <input
          type="text"
          placeholder={t('filesFilterPlaceholder', lang)}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div
        className="flex-1 overflow-y-auto p-2 min-h-0"
        onClick={(e) => {
          // Clicking empty space clears the selection, so uploads go to the folder shown.
          if (e.target === e.currentTarget) setSelected(null)
        }}
      >
        {body()}
      </div>
    </div>
  )
}
