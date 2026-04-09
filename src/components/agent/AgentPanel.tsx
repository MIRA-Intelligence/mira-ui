import { useState, useRef, useEffect, useMemo } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { wsClient } from '@/services/websocket'
import { fetchSessionHistory } from '@/services/api'
import { LogEntry } from './LogEntry'
import { formatTime } from '@/lib/utils'
import type { LogEntry as AgentLogEntry } from '@/types'
import { t } from '@/i18n'

type RenderItem =
  | { kind: 'entry'; entry: AgentLogEntry }
  | { kind: 'activity_group'; id: string; entries: AgentLogEntry[] }

function ChatComposer({
  selectedTaskId,
  isStreaming,
  lang,
  onSend,
  onStop,
}: {
  selectedTaskId: string | null
  isStreaming: boolean
  lang: ReturnType<typeof useSettingsStore.getState>['language']
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [input, setInput] = useState('')

  useEffect(() => {
    setInput('')
  }, [selectedTaskId])

  const sendCurrent = () => {
    const text = input.trim()
    if (!text || !selectedTaskId) return
    onSend(text)
    setInput('')
  }

  return (
    <div className="p-3 border-t border-[var(--color-border)] shrink-0">
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault()
              sendCurrent()
            }
          }}
          placeholder={selectedTaskId ? t('typeMessage', lang) : t('selectProjectFirst', lang)}
          disabled={!selectedTaskId}
          rows={1}
          className="flex-1 h-9 overflow-y-auto bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50 resize-none"
        />
        <button
          onClick={sendCurrent}
          disabled={!selectedTaskId}
          className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors shrink-0 disabled:opacity-50"
        >
          {t('send', lang)}
        </button>
        <button
          onClick={onStop}
          disabled={!selectedTaskId}
          title={isStreaming ? t('stopCurrentTask', lang) : t('cancelAutoOrStop', lang)}
          className="px-3 py-2 rounded-lg bg-red-500/15 text-red-400 text-sm font-medium hover:bg-red-500/25 transition-colors shrink-0 disabled:opacity-50"
        >
          {t('stop', lang)}
        </button>
      </div>
    </div>
  )
}

export function AgentPanel() {
  const { connected, logsByProject, hydrateLogs, isStreaming } = useAgentStore()
  const showProgressMessages = useSettingsStore((s) => s.showProgressMessages)
  const lang = useSettingsStore((s) => s.language)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const mode = useProjectStore((s) => s.mode)
  const isAuto = mode === 'auto'

  const logs = selectedTaskId ? (logsByProject[selectedTaskId] ?? []) : []

  const [collapsedProgressGroups, setCollapsedProgressGroups] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let activityBuffer: AgentLogEntry[] = []

    const flushActivity = () => {
      if (activityBuffer.length === 0) return
      const first = activityBuffer[0]
      items.push({
        kind: 'activity_group',
        id: `activity:${first.id}`,
        entries: activityBuffer,
      })
      activityBuffer = []
    }

    for (const entry of logs) {
      if (entry.type === 'progress' || entry.type === 'tool_call') {
        activityBuffer.push(entry)
        continue
      }
      flushActivity()
      items.push({ kind: 'entry', entry })
    }
    flushActivity()
    return items
  }, [logs])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length])

  useEffect(() => {
    setCollapsedProgressGroups({})
  }, [showProgressMessages, selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) return

    let cancelled = false
    void (async () => {
      const history = await fetchSessionHistory(selectedTaskId)
      if (cancelled || history.length === 0) return
      hydrateLogs(selectedTaskId, history)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedTaskId, hydrateLogs])

  useEffect(() => {
    if (!connected || !selectedTaskId) return
    // Re-bind current session after websocket reconnects so progress streaming resumes.
    wsClient.send({
      type: 'bind',
      content: '',
      session_id: selectedTaskId,
      user_id: 'ui_user',
    })
  }, [connected, selectedTaskId])

  const handleSend = (text: string) => {
    if (!selectedTaskId) return
    useAgentStore.getState().addLog(selectedTaskId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: text,
      type: 'response',
      metadata: { _user: true },
    })

    const { mode: currentMode, agentProfile: currentAgentProfile } = useProjectStore.getState()
    wsClient.send({
      type: 'message',
      content: text,
      session_id: selectedTaskId,
      user_id: 'ui_user',
      mode: currentMode,
      agent_profile: currentAgentProfile,
    })
  }

  const handleResend = (content: string) => {
    if (!selectedTaskId) return

    useAgentStore.getState().addLog(selectedTaskId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content,
      type: 'response',
      metadata: { _user: true },
    })

    const { mode: currentMode, agentProfile: currentAgentProfile } = useProjectStore.getState()
    wsClient.send({
      type: 'message',
      content,
      session_id: selectedTaskId,
      user_id: 'ui_user',
      mode: currentMode,
      agent_profile: currentAgentProfile,
    })
  }

  const handleStop = () => {
    if (!selectedTaskId) return

    wsClient.send({
      type: 'message',
      content: '/stop',
      session_id: selectedTaskId,
      user_id: 'ui_user',
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          {t('agentChat', lang)}
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {connected ? t('connected', lang) : t('disconnected', lang)}
        </span>
        {isAuto && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)] font-medium">
            AUTO
          </span>
        )}
        {selectedTaskId && (
          <span className="ml-auto text-[10px] font-mono text-[var(--color-text-muted)]">
            {selectedTaskId}
          </span>
        )}
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {renderItems.map((item) => {
          if (item.kind === 'activity_group') {
            const collapsed = collapsedProgressGroups[item.id] ?? !showProgressMessages
            const last = item.entries[item.entries.length - 1]
            const lastLine = last?.content.split('\n')[0] ?? t('progressUpdate', lang)
            const firstTs = item.entries[0]?.timestamp
            const lastTs = last?.timestamp

            return (
              <div key={item.id} className="px-4 py-1.5">
                <button
                  onClick={() => {
                    setCollapsedProgressGroups((prev) => ({
                      ...prev,
                      [item.id]: !(prev[item.id] ?? !showProgressMessages),
                    }))
                  }}
                  className="w-full text-left flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  <span>{collapsed ? '▷' : '▽'}</span>
                  <span className="uppercase tracking-wide">{t('progress', lang)}</span>
                  <span className="font-mono">{item.entries.length}</span>
                  {firstTs && (
                    <span className="font-mono">{formatTime(firstTs)}{lastTs && lastTs !== firstTs ? `-${formatTime(lastTs)}` : ''}</span>
                  )}
                  {collapsed && (
                    <span className="truncate">- {last?.type === 'tool_call' ? `🔧 ${lastLine}` : lastLine}</span>
                  )}
                </button>
                {!collapsed && (
                  <div className="mt-1 ml-4 space-y-2">
                    {item.entries.map((entry) => (
                      <div key={entry.id}>
                        <div className="text-xs text-[var(--color-text-muted)] mb-1 font-mono">
                          {formatTime(entry.timestamp)}
                        </div>
                        {entry.type === 'tool_call' ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[var(--color-text-muted)]">🔧</span>
                            <span className="px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] font-mono">
                              {entry.content}
                            </span>
                          </div>
                        ) : (
                          <div className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-text-secondary)]">
                            {entry.content}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          const entry = item.entry
          const isUser = !!entry.metadata?._user
          const isAutoMsg = !!entry.metadata?._auto
          if (isUser) {
            return (
              <div key={entry.id} className="group/msg px-4 py-2">
                <div className={`text-sm rounded-lg p-2.5 leading-relaxed whitespace-pre-wrap ml-8 ${
                  isAutoMsg
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-text-secondary)] italic'
                    : 'bg-[var(--color-accent)]/15 text-[var(--color-text-primary)]'
                }`}>
                  {isAutoMsg && (
                    <span className="text-[10px] font-semibold text-[var(--color-success)] uppercase mr-1.5 not-italic">AUTO</span>
                  )}
                  {entry.content}
                </div>
                <div className="flex justify-end mt-1 mr-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleResend(entry.content)}
                    title={t('resend', lang)}
                    className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          }
          return <LogEntry key={entry.id} entry={entry} />
        })}

        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs">
              {selectedTaskId ? t('sendMessageToStart', lang) : t('selectProjectFirst', lang)}
            </span>
          </div>
        )}
      </div>

      <ChatComposer
        selectedTaskId={selectedTaskId}
        isStreaming={isStreaming}
        lang={lang}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  )
}
