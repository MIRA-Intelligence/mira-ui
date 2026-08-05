import { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Language } from '@/stores/settingsStore'
import { wsClient } from '@/services/websocket'
import type { Stats } from '@/types'
import { QueueItem } from './QueueItem'
import { ChatItem } from './ChatItem'
import { FolderRow } from './FolderRow'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { useOrganizationStore, type OrganizationKind } from '@/stores/organizationStore'

const MODE_SWITCH_POLL_INTERVAL_MS = 1000
const MODE_SWITCH_POLL_TIMEOUT_MS = 20000
const ORGANIZATION_DRAG_TYPE = 'application/x-mira-organization-item'
const UNCATEGORIZED_ID = '__uncategorized__'

export function ProjectQueue() {
  const {
    tasks,
    appMode,
    selectedTaskId,
    selectTask,
    mode,
    setMode,
    renameTask,
    deleteTask,
    duplicateTask,
    refreshPlan,
    stats,
  } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)
  const openNewProject = useUiStore((s) => s.openNewProject)
  const pushSystemMessage = useUiStore((s) => s.pushSystemMessage)
  const modePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modePollDeadlineRef = useRef<number>(0)

  const handleDelete = async (id: string, deleteFiles: boolean) => {
    try {
      await deleteTask(id, deleteFiles)
      pushSystemMessage(
        t(deleteFiles ? 'projectDeletedFromDisk' : 'projectRemovedFromUi', lang),
        { severity: 'success', ttlMs: 4000 },
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      pushSystemMessage(
        t('projectDeleteFailed', lang, { reason: reason || t('unknownError', lang) }),
        { severity: 'error', ttlMs: 7000 },
      )
    }
  }
  const { chats, activeChatId, workspaceKey, createChat, selectChat, renameChat, deleteChat } = useChatStore()
  const { folders, assignments, loaded: organizationLoaded, createFolder, renameFolder, deleteFolder, moveItem } = useOrganizationStore()
  const isChatActive = appMode === 'normal'

  // Which list the rail is showing. Follows the active surface so entering a
  // chat reveals the Chats tab and selecting a project reveals Projects, while
  // still letting the user browse the other list without switching modes.
  const [tab, setTab] = useState<'chats' | 'projects'>(isChatActive ? 'chats' : 'projects')
  const [search, setSearch] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  useEffect(() => {
    setTab(isChatActive ? 'chats' : 'projects')
  }, [isChatActive])

  const collapseStorageKey = `mira:organization:collapsed:${workspaceKey}:${tab}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      setCollapsedFolders(new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []))
    } catch {
      setCollapsedFolders(new Set())
    }
  }, [collapseStorageKey])

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      try { localStorage.setItem(collapseStorageKey, JSON.stringify([...next])) } catch { /* ignore cache errors */ }
      return next
    })
  }

  const handleSelectTask = (id: string) => {
    selectTask(id)
  }

  const stopModePoll = () => {
    if (!modePollRef.current) return
    clearInterval(modePollRef.current)
    modePollRef.current = null
  }

  const startModeSyncPolling = (sessionId: string) => {
    stopModePoll()
    modePollDeadlineRef.current = Date.now() + MODE_SWITCH_POLL_TIMEOUT_MS

    const tick = async () => {
      await useProjectStore.getState().refreshPlan(sessionId)
      const task = useProjectStore.getState().tasks.find((t) => t.id === sessionId)
      const hasRunningExperiment = !!task?.experiments.some((e) => e.status === 'running')
      const timedOut = Date.now() >= modePollDeadlineRef.current
      if (!hasRunningExperiment || timedOut) {
        stopModePoll()
      }
    }

    void tick()
    modePollRef.current = setInterval(() => {
      void tick()
    }, MODE_SWITCH_POLL_INTERVAL_MS)
  }

  const handleModeSwitch = (nextMode: 'manual' | 'auto') => {
    if (appMode === 'normal') return
    if (mode === nextMode) return
    setMode(nextMode)
    if (!selectedTaskId) return

    wsClient.send({
      type: 'set_mode',
      content: '',
      session_id: selectedTaskId,
      user_id: 'ui_user',
      mode: nextMode,
    })

    void refreshPlan(selectedTaskId)
    startModeSyncPolling(selectedTaskId)
  }

  useEffect(() => () => stopModePoll(), [])
  const isAutoMode = mode === 'auto'

  const showChats = tab === 'chats'
  const currentKind: OrganizationKind = showChats ? 'chat' : 'project'
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  )
  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders])

  const itemMatches = (title: string) => !normalizedSearch || title.toLocaleLowerCase().includes(normalizedSearch)
  const chatGroups = sortedFolders.map((folder) => {
    const all = chats
      .filter((chat) => assignments.chat[chat.id] === folder.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const items = folder.name.toLocaleLowerCase().includes(normalizedSearch) ? all : all.filter((chat) => itemMatches(chat.title))
    return { folder, items }
  })
  const projectGroups = sortedFolders.map((folder) => {
    const all = tasks
      .filter((task) => assignments.project[task.id] === folder.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    const items = folder.name.toLocaleLowerCase().includes(normalizedSearch) ? all : all.filter((task) => itemMatches(task.label))
    return { folder, items }
  })
  const uncategorizedChats = chats
    .filter((chat) => {
      const folderId = assignments.chat[chat.id]
      return (!folderId || !folderIds.has(folderId)) && itemMatches(chat.title)
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const uncategorizedProjects = tasks
    .filter((task) => {
      const folderId = assignments.project[task.id]
      return (!folderId || !folderIds.has(folderId)) && itemMatches(task.label)
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

  const reportOrganizationError = (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    pushSystemMessage(t('folderSaveFailed', lang, { reason }), { severity: 'error', ttlMs: 6000 })
  }

  const submitFolder = async () => {
    const name = folderDraft.trim()
    if (!name) return
    try {
      await createFolder(name)
      setFolderDraft('')
      setCreatingFolder(false)
    } catch (error) {
      reportOrganizationError(error)
    }
  }

  const handleMove = async (kind: OrganizationKind, itemId: string, folderId: string | null) => {
    if (!organizationLoaded) return
    try {
      await moveItem(kind, itemId, folderId)
    } catch (error) {
      reportOrganizationError(error)
    }
  }

  const handleDrop = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault()
    try {
      const payload = JSON.parse(event.dataTransfer.getData(ORGANIZATION_DRAG_TYPE)) as { kind?: unknown; itemId?: unknown }
      if ((payload.kind === 'chat' || payload.kind === 'project') && typeof payload.itemId === 'string') {
        void handleMove(payload.kind, payload.itemId, folderId)
      }
    } catch {
      // Ignore drags that did not originate from an organization item.
    }
  }

  const dragProps = (kind: OrganizationKind, itemId: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(ORGANIZATION_DRAG_TYPE, JSON.stringify({ kind, itemId }))
    },
  })

  return (
    <aside className="flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tab bar: Chats | Projects + contextual add */}
      <div className="flex items-stretch border-b border-[var(--color-border)]">
        <TabButton active={showChats} count={chats.length} onClick={() => setTab('chats')}>
          {t('conversations', lang)}
        </TabButton>
        <TabButton active={!showChats} count={tasks.length} onClick={() => setTab('projects')}>
          {t('projectsSection', lang)}
        </TabButton>
        <button
          onClick={() => (showChats ? createChat() : openNewProject())}
          className="w-7 shrink-0 flex items-center justify-center border-l border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          aria-label={showChats ? t('newChatAria', lang) : t('newProjectAria', lang)}
          title={showChats ? t('newChat', lang) : t('newProjectAria', lang)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={() => setCreatingFolder(true)}
          disabled={!organizationLoaded}
          className="flex w-7 shrink-0 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          aria-label={t('newFolder', lang)}
          title={t('newFolder', lang)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
            <path d="M12 10v6M9 13h6" />
          </svg>
        </button>
      </div>

      {!showChats && <QueueStatsBar stats={stats} taskCount={tasks.length} lang={lang} />}

      <div className="border-b border-[var(--color-border)] p-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchConversationsProjects', lang)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
        />
      </div>

      {/* Active list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {creatingFolder && (
          <div className="mb-2 flex gap-1">
            <input
              autoFocus
              value={folderDraft}
              maxLength={60}
              onChange={(event) => setFolderDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitFolder()
                if (event.key === 'Escape') { setCreatingFolder(false); setFolderDraft('') }
              }}
              placeholder={t('folderNamePlaceholder', lang)}
              className="min-w-0 flex-1 rounded-md border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs outline-none"
            />
            <button type="button" onClick={() => void submitFolder()} className="rounded-md bg-[var(--color-accent)] px-2 text-xs text-white">
              {t('save', lang)}
            </button>
          </div>
        )}
        {showChats ? (
          chats.length === 0 && !normalizedSearch ? (
            <p className="px-3 py-4 text-[11px] text-center text-[var(--color-text-muted)]">
              {t('noConversationsYet', lang)}
            </p>
          ) : (
            <>
              {chatGroups.filter(({ folder, items }) => !normalizedSearch || items.length > 0 || folder.name.toLocaleLowerCase().includes(normalizedSearch)).map(({ folder, items }) => (
                <div key={folder.id}>
                  <FolderRow
                    name={folder.name}
                    mutable={organizationLoaded}
                    count={chats.filter((chat) => assignments.chat[chat.id] === folder.id).length}
                    expanded={normalizedSearch.length > 0 || !collapsedFolders.has(folder.id)}
                    onToggle={() => toggleFolder(folder.id)}
                    onRename={(name) => { void renameFolder(folder.id, name).catch(reportOrganizationError) }}
                    onDelete={() => {
                      if (window.confirm(t('deleteFolderConfirm', lang, { name: folder.name }))) {
                        void deleteFolder(folder.id).catch(reportOrganizationError)
                      }
                    }}
                    onDropItem={(event) => handleDrop(event, folder.id)}
                  />
                  {(normalizedSearch.length > 0 || !collapsedFolders.has(folder.id)) && items.map((chat) => (
                    <div key={chat.id} className="ml-3" {...dragProps('chat', chat.id)}>
                      <ChatItem chat={chat} isSelected={isChatActive && chat.id === activeChatId} onSelect={selectChat} onRename={renameChat} onDelete={deleteChat} folders={sortedFolders} currentFolderId={folder.id} onMove={(id, folderId) => { void handleMove('chat', id, folderId) }} />
                    </div>
                  ))}
                </div>
              ))}
              {uncategorizedChats.length > 0 && (
                <div>
                  <FolderRow name={t('uncategorized', lang)} count={uncategorizedChats.length} virtual expanded={normalizedSearch.length > 0 || !collapsedFolders.has(UNCATEGORIZED_ID)} onToggle={() => toggleFolder(UNCATEGORIZED_ID)} onDropItem={(event) => handleDrop(event, null)} />
                  {(normalizedSearch.length > 0 || !collapsedFolders.has(UNCATEGORIZED_ID)) && uncategorizedChats.map((chat) => (
                    <div key={chat.id} className="ml-3" {...dragProps('chat', chat.id)}>
                      <ChatItem chat={chat} isSelected={isChatActive && chat.id === activeChatId} onSelect={selectChat} onRename={renameChat} onDelete={deleteChat} folders={sortedFolders} currentFolderId={null} onMove={(id, folderId) => { void handleMove('chat', id, folderId) }} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        ) : (
          <>
            {projectGroups.filter(({ folder, items }) => !normalizedSearch || items.length > 0 || folder.name.toLocaleLowerCase().includes(normalizedSearch)).map(({ folder, items }) => (
              <div key={folder.id}>
                <FolderRow
                  name={folder.name}
                  mutable={organizationLoaded}
                  count={tasks.filter((task) => assignments.project[task.id] === folder.id).length}
                  expanded={normalizedSearch.length > 0 || !collapsedFolders.has(folder.id)}
                  onToggle={() => toggleFolder(folder.id)}
                  onRename={(name) => { void renameFolder(folder.id, name).catch(reportOrganizationError) }}
                  onDelete={() => {
                    if (window.confirm(t('deleteFolderConfirm', lang, { name: folder.name }))) {
                      void deleteFolder(folder.id).catch(reportOrganizationError)
                    }
                  }}
                  onDropItem={(event) => handleDrop(event, folder.id)}
                />
                {(normalizedSearch.length > 0 || !collapsedFolders.has(folder.id)) && items.map((task) => (
                  <div key={task.id} className="ml-3" {...dragProps('project', task.id)}>
                    <QueueItem task={task} isSelected={!isChatActive && task.id === selectedTaskId} onSelect={handleSelectTask} onRename={renameTask} onDelete={handleDelete} onDuplicate={duplicateTask} folders={sortedFolders} currentFolderId={folder.id} onMove={(id, folderId) => { void handleMove('project', id, folderId) }} />
                  </div>
                ))}
              </div>
            ))}
            {uncategorizedProjects.length > 0 && (
              <div>
                <FolderRow name={t('uncategorized', lang)} count={uncategorizedProjects.length} virtual expanded={normalizedSearch.length > 0 || !collapsedFolders.has(UNCATEGORIZED_ID)} onToggle={() => toggleFolder(UNCATEGORIZED_ID)} onDropItem={(event) => handleDrop(event, null)} />
                {(normalizedSearch.length > 0 || !collapsedFolders.has(UNCATEGORIZED_ID)) && uncategorizedProjects.map((task) => (
                  <div key={task.id} className="ml-3" {...dragProps('project', task.id)}>
                    <QueueItem task={task} isSelected={!isChatActive && task.id === selectedTaskId} onSelect={handleSelectTask} onRename={renameTask} onDelete={handleDelete} onDuplicate={duplicateTask} folders={sortedFolders} currentFolderId={null} onMove={(id, folderId) => { void handleMove('project', id, folderId) }} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {appMode === 'project' && !showChats && (
        <div className="p-3 border-t border-[var(--color-border)] flex items-center justify-center">
          <div className="relative w-full max-w-[220px] rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1">
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute left-1 top-1 bottom-1 rounded-full transition-transform duration-200 ease-out',
                isAutoMode ? 'bg-[var(--color-success)]' : 'bg-[var(--color-accent)]',
              )}
              style={{
                width: 'calc(50% - 0.25rem)',
                transform: isAutoMode ? 'translateX(100%)' : 'translateX(0%)',
              }}
            />

            <div className="relative z-10 grid grid-cols-2">
              {(['manual', 'auto'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSwitch(m)}
                  className={cn(
                    'py-1.5 text-xs font-medium rounded-full transition-colors',
                    mode === m ? 'text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {t(m, lang)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 px-2 py-2 text-xs font-semibold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 border-b-2',
        active
          ? 'text-[var(--color-text-primary)] border-[var(--color-accent)]'
          : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-secondary)]',
      )}
    >
      <span className="truncate">{children}</span>
      {count > 0 && (
        <span className={cn(
          'text-[10px] font-mono px-1 rounded tabular-nums',
          active ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]',
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

function QueueStatsBar({
  stats,
  taskCount,
  lang,
}: {
  stats: Stats
  taskCount: number
  lang: Language
}) {
  if (taskCount === 0 && stats.experiments === 0) return null

  const totalKey = taskCount === 1 ? 'queueSummaryTotal' : 'queueSummaryTotalPlural'

  return (
    <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/30 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)] tabular-nums">
      <span>{t(totalKey, lang, { count: taskCount })}</span>
      {stats.experiments > 0 && (
        <>
          <span aria-hidden className="text-[var(--color-text-muted)]/50">·</span>
          <span title={t('experiments', lang)}>
            <span className="text-[var(--color-text-secondary)] font-medium">{stats.completed}</span>
            <span className="opacity-60">/{stats.experiments}</span>
            <span className="ml-1 opacity-70">{t('experiment', lang)}</span>
          </span>
        </>
      )}
      {stats.running > 0 && (
        <span className="flex items-center gap-1 text-[var(--color-accent)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" aria-hidden />
          {t('queueSummaryRunning', lang, { count: stats.running })}
        </span>
      )}
      {stats.failed > 0 && (
        <span className="flex items-center gap-1 text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" aria-hidden />
          {t('queueSummaryFailed', lang, { count: stats.failed })}
        </span>
      )}
    </div>
  )
}
