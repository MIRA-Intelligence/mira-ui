import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteProjectFile,
  fetchProjectFilesResult,
  getProjectArtifactUrl,
  uploadProjectFiles,
} from '@/services/api'
import { fetchAllProjectFiles, toProjectScopedEntries } from '@/services/projectFiles'
import type { FileExplorerScope, ProjectFileEntry } from '@/types'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { ArtifactPreview } from '@/components/artifacts'

interface FileTreeNode {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime: number
  children: Record<string, FileTreeNode>
}

function resolveScope(appMode: 'normal' | 'project'): FileExplorerScope {
  return appMode === 'project' ? 'project' : 'all'
}

export function ResourceExplorer({ embedded = false }: { embedded?: boolean }) {
  const appMode = useProjectStore((s) => s.appMode)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const tasks = useProjectStore((s) => s.tasks)
  const projectsLoaded = useProjectStore((s) => s.projectsLoaded)
  const lang = useSettingsStore((s) => s.language)
  const pushSystemMessage = useUiStore((s) => s.pushSystemMessage)
  const chatCenterPreviewFile = useUiStore((s) => s.chatCenterPreviewFile)
  const setChatCenterPreviewFile = useUiStore((s) => s.setChatCenterPreviewFile)

  const scope = resolveScope(appMode)
  const isProjectMode = appMode === 'project'
  const selectedTask = tasks.find((t) => t.id === selectedTaskId)
  const taskIdsKey = tasks.map((t) => t.id).join(',')

  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<ProjectFileEntry | null>(null)
  const [previewFile, setPreviewFile] = useState<ProjectFileEntry | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadHint, setUploadHint] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const dataInputRef = useRef<HTMLInputElement>(null)
  const referencesInputRef = useRef<HTMLInputElement>(null)

  const resolveUploadProjectId = useCallback((): string | null => {
    return selectedTaskId
  }, [selectedTaskId])

  const canUpload = Boolean(resolveUploadProjectId())

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      if (scope === 'project') {
        if (!selectedTaskId) {
          setFiles([])
          return
        }
        const result = await fetchProjectFilesResult(selectedTaskId)
        if (!result.ok) {
          setFiles([])
          setLoadError(
            result.status === 405
              ? t('filesListNotSupported', lang)
              : t('filesLoadFailed', lang, {
                  status: result.status || '—',
                  detail: result.error ?? '',
                }),
          )
          return
        }
        setFiles(toProjectScopedEntries(selectedTaskId, result.files))
        return
      }
      const data = await fetchAllProjectFiles(tasks.map((t) => ({ id: t.id, label: t.label })))
      setFiles(data)
    } catch (err) {
      console.error('Failed to load files:', err)
      setFiles([])
      setLoadError(t('filesLoadFailed', lang, { status: '—', detail: '' }))
    } finally {
      setLoading(false)
    }
  }, [scope, selectedTaskId, taskIdsKey, tasks, lang])

  useEffect(() => {
    void loadFiles()
    setSelectedFile(null)
    setPreviewFile(null)
    setChatCenterPreviewFile(null)
  }, [loadFiles, projectsLoaded, setChatCenterPreviewFile])

  const showProjectEmpty = scope === 'project' && !selectedTaskId
  const showWorkspaceEmpty = scope === 'all' && tasks.length === 0 && projectsLoaded

  const buildTree = (fileList: ProjectFileEntry[]): FileTreeNode => {
    const root: FileTreeNode = {
      name: '',
      path: '',
      isDir: true,
      size: 0,
      mtime: 0,
      children: {},
    }

    fileList.forEach((file) => {
      const parts = file.path.split('/')
      let current = root
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
            isDir: isLast ? file.is_dir : true,
            size: isLast ? file.size : 0,
            mtime: isLast ? file.mtime : 0,
            children: {},
          }
        }
        current = current.children[part]
      })
    })

    return root
  }

  const handleDelete = async (file: ProjectFileEntry) => {
    if (!confirm(t('deleteFileConfirm', lang))) return
    try {
      const ok = await deleteProjectFile(file.projectId, file.relativePath)
      if (ok) {
        pushSystemMessage(t('deleteFileSuccess', lang), { severity: 'success' })
        if (selectedFile?.path === file.path) setSelectedFile(null)
        if (previewFile?.path === file.path) setPreviewFile(null)
        if (chatCenterPreviewFile?.path === file.path) setChatCenterPreviewFile(null)
        void loadFiles()
      } else {
        pushSystemMessage(t('deleteFileFailed', lang), { severity: 'error' })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('deleteFileFailed', lang)
      pushSystemMessage(message, { severity: 'error' })
    }
  }

  const showUploadBlocked = () => {
    const msg = t('uploadSelectProjectFirst', lang)
    setUploadHint(msg)
    pushSystemMessage(msg, { severity: 'warning', ttlMs: 6000 })
  }

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'data' | 'references',
  ) => {
    const selectedFiles = Array.from(e.target.files || [])
    e.target.value = ''
    if (selectedFiles.length === 0) return

    const pid = resolveUploadProjectId()
    if (!pid) {
      showUploadBlocked()
      return
    }

    setUploadHint(null)
    setIsUploading(true)
    try {
      await uploadProjectFiles(pid, selectedFiles, target)
      pushSystemMessage(t('uploadedSuccessfully', lang), { severity: 'success' })
      void loadFiles()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('uploadFailed', lang)
      pushSystemMessage(message, { severity: 'error' })
    } finally {
      setIsUploading(false)
    }
  }

  const toggleNode = (path: string) => {
    const next = new Set(expandedNodes)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setExpandedNodes(next)
  }

  const filterTree = (node: FileTreeNode, query: string): boolean => {
    if (!query) return true
    const childrenKeys = Object.keys(node.children)
    let hasMatchingChild = false
    childrenKeys.forEach((key) => {
      const isMatch = filterTree(node.children[key], query)
      if (!isMatch) delete node.children[key]
      else hasMatchingChild = true
    })
    return node.name.toLowerCase().includes(query.toLowerCase()) || hasMatchingChild
  }

  const rawTree = useMemo(() => {
    const tree = buildTree(files)
    if (searchQuery) filterTree(tree, searchQuery)
    return tree
  }, [files, searchQuery])

  const renderNode = (node: FileTreeNode, depth = 0) => {
    const hasChildren = Object.keys(node.children).length > 0
    const isExpanded = expandedNodes.has(node.path)
    const fileInfo = files.find((f) => f.path === node.path)

    if (!node.name) {
      return (
        <div className="space-y-0.5">
          {Object.values(node.children).map((child) => renderNode(child, depth))}
        </div>
      )
    }

    const entry: ProjectFileEntry | null = fileInfo ?? null
    const activeFilePath = isProjectMode ? selectedFile?.path : chatCenterPreviewFile?.path

    return (
      <div key={node.path} className="select-none">
        <div
          onClick={() => {
            if (node.isDir) toggleNode(node.path)
            else if (entry) {
              if (isProjectMode) setSelectedFile(entry)
              else setChatCenterPreviewFile(entry)
            }
          }}
          className={cn(
            'group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors text-xs font-mono',
            activeFilePath === node.path
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {node.isDir ? (
            <span
              className="w-3.5 h-3.5 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
            >
              ▶
            </span>
          ) : (
            <span className="w-3.5" />
          )}
          <span className="text-sm shrink-0">{node.isDir ? '📁' : getFileIcon(node.name)}</span>
          <span className="truncate flex-1" title={node.name}>
            {node.name}
          </span>
          {!node.isDir && entry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleDelete(entry)
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--color-text-muted)] hover:text-red-500"
              title={t('delete', lang)}
            >
              🗑
            </button>
          )}
        </div>
        {node.isDir && isExpanded && hasChildren && (
          <div className="mt-0.5">
            {Object.values(node.children).map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const formatDate = (mtimeMs: number) => {
    if (!mtimeMs) return '-'
    const ms = mtimeMs < 10000000000 ? mtimeMs * 1000 : mtimeMs
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const emptyState = () => {
    if (showProjectEmpty) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('selectProjectToSeeFiles', lang)}</p>
        </div>
      )
    }
    if (showWorkspaceEmpty) {
      return (
        <p className="text-center py-8 text-xs text-[var(--color-text-muted)] px-4">
          {t('noWorkspaceFiles', lang)}
        </p>
      )
    }
    if (loadError) {
      return (
        <div className="text-center py-8 px-4 space-y-2">
          <p className="text-xs text-amber-400/90 leading-snug">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadFiles()}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            {t('refreshFiles', lang)}
          </button>
        </div>
      )
    }
    return (
      <p className="text-center py-8 text-xs text-[var(--color-text-muted)]">{t('noFilesYet', lang)}</p>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-[var(--color-bg-secondary)] select-none',
        !embedded && 'border-r border-[var(--color-border)]',
      )}
    >
      <div className="px-2 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        {!embedded && (
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] block px-1 mb-2">
            {t('filesTab', lang)}
          </span>
        )}
        <div className="flex items-center gap-2 min-w-0">
          {isProjectMode && (
            <div
              className="min-w-0 flex-[0_1_42%] px-2 py-1 text-[10px] font-mono truncate text-[var(--color-text-secondary)]"
              title={selectedTask?.label || selectedTaskId || undefined}
            >
              {selectedTaskId
                ? t('filesForProject', lang, {
                    name: selectedTask?.label || selectedTaskId,
                  })
                : t('selectProjectToSeeFiles', lang)}
            </div>
          )}
          <input
            type="text"
            placeholder={t('filesFilterPlaceholder', lang)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-w-[96px] flex-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <div className={cn('flex items-center shrink-0 gap-0.5', !isProjectMode && 'ml-auto')}>
            {canUpload ? (
              <label
                htmlFor="mira-upload-data"
                className={cn(
                  'p-1.5 rounded cursor-pointer hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]',
                  isUploading && 'pointer-events-none opacity-50',
                )}
                title={t('uploadDataTitle', lang)}
              >
                ↑
              </label>
            ) : (
              <button
                type="button"
                onClick={showUploadBlocked}
                className="p-1.5 rounded opacity-40 text-[var(--color-text-muted)]"
                title={t('uploadDataTitle', lang)}
              >
                ↑
              </button>
            )}
            {canUpload ? (
              <label
                htmlFor="mira-upload-references"
                className={cn(
                  'p-1.5 rounded cursor-pointer hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]',
                  isUploading && 'pointer-events-none opacity-50',
                )}
                title={t('uploadReferencesTitle', lang)}
              >
                📎
              </label>
            ) : (
              <button
                type="button"
                onClick={showUploadBlocked}
                className="p-1.5 rounded opacity-40 text-[var(--color-text-muted)]"
                title={t('uploadReferencesTitle', lang)}
              >
                📎
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadFiles()}
              disabled={loading}
              className={cn(
                'p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]',
                loading && 'animate-spin opacity-70',
              )}
              title={t('refreshFiles', lang)}
            >
              ↻
            </button>
          </div>
        </div>
        {uploadHint && (
          <p className="mt-1.5 px-1 text-[10px] text-amber-400/90 leading-snug">{uploadHint}</p>
        )}
      </div>

      <input
        id="mira-upload-data"
        ref={dataInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => void handleFileChange(e, 'data')}
      />
      <input
        id="mira-upload-references"
        ref={referencesInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => void handleFileChange(e, 'references')}
      />

      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {showProjectEmpty || showWorkspaceEmpty ? (
          emptyState()
        ) : loading && files.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">{t('loading', lang)}</div>
        ) : files.length === 0 ? (
          emptyState()
        ) : (
          renderNode(rawTree)
        )}
      </div>

      {isUploading && (
        <div className="p-2 border-t text-center text-xs text-[var(--color-text-muted)]">{t('loading', lang)}</div>
      )}

      {isProjectMode && selectedFile && (
        <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-mono text-[var(--color-text-muted)] truncate">{selectedFile.path}</p>
          <p className="text-xs font-semibold truncate">{selectedFile.name}</p>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-[var(--color-text-muted)] font-mono">
            <span>Size: {formatSize(selectedFile.size)}</span>
            <span className="text-right">Date: {formatDate(selectedFile.mtime)}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPreviewFile(selectedFile)}
              className="flex-1 py-1 rounded bg-[var(--color-accent)] text-white text-xs"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => {
                const url = getProjectArtifactUrl(selectedFile.projectId, selectedFile.relativePath)
                const link = document.createElement('a')
                link.href = url
                link.download = selectedFile.name
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
              }}
              className="p-1 rounded border text-xs"
              title={t('downloadArtifact', lang)}
            >
              ⬇
            </button>
          </div>
        </div>
      )}

      {isProjectMode && previewFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60">
          <div className="relative w-full max-w-4xl h-[85vh] flex flex-col rounded-xl border bg-[var(--color-bg-primary)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <span className="text-sm font-semibold truncate">{previewFile.name}</span>
              <button type="button" onClick={() => setPreviewFile(null)} className="px-2">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <ArtifactPreview
                path={previewFile.relativePath}
                url={getProjectArtifactUrl(previewFile.projectId, previewFile.relativePath)}
                enabled
                label={previewFile.name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'py':
    case 'sh':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return '📄'
    case 'json':
      return '⚙️'
    case 'csv':
    case 'tsv':
      return '📊'
    case 'pdf':
      return '📕'
    case 'zip':
    case 'gz':
    case 'tar':
      return '📦'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return '🖼️'
    case 'md':
      return '📝'
    case 'log':
    case 'txt':
      return '🗒️'
    default:
      return '📄'
  }
}
