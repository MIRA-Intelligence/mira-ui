import { useState, useRef, useEffect, useMemo } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { wsClient } from '@/services/websocket'
import { fetchSessionHistory } from '@/services/api'
import { LogEntry } from './LogEntry'
import { formatTime } from '@/lib/utils'
import type { LogEntry as AgentLogEntry } from '@/types'
import { t } from '@/i18n'
import { GLOBAL_SKILLS_SESSION_ID, useSkillPluginsStore } from '@/stores/skillPluginsStore'

function createClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Condense a log line into a short one-line activity label for the working
// indicator (collapse whitespace, drop trailing noise, cap the length).
function condenseActivity(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

// Derive the operation Mira is running right now from the most recent trailing
// activity entry. Keep the actual tool-call summary (including useful args)
// instead of reducing it to just the tool name.
function deriveActivityLabel(logs: AgentLogEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (entry.type !== 'tool_call' && entry.type !== 'progress') {
      // Reached a finalized response / user message: no active task trailing.
      break
    }
    const raw = (entry.content ?? '').trim()
    if (!raw) continue
    return condenseActivity(raw, 80)
  }
  return null
}

// Build a project-description seed from a chat's transcript so promoting a
// conversation into a research project carries the context forward.
function buildPromotePrefill(logs: AgentLogEntry[]): string {
  const lines: string[] = []
  for (const entry of logs) {
    if (entry.type !== 'response') continue
    const who = entry.metadata?._user ? 'User' : 'Mira'
    const text = entry.content.trim()
    if (!text) continue
    lines.push(`${who}: ${text}`)
  }
  return lines.join('\n\n').slice(0, 4000)
}

type RenderItem =
  | { kind: 'entry'; entry: AgentLogEntry }
  | { kind: 'activity_group'; id: string; entries: AgentLogEntry[] }

function ChatComposer({
  sessionId,
  isStreaming,
  isStopping,
  lang,
  availableSkills,
  onSend,
  onStop,
}: {
  sessionId: string | null
  isStreaming: boolean
  isStopping: boolean
  lang: ReturnType<typeof useSettingsStore.getState>['language']
  availableSkills: string[]
  onSend: (text: string, selectedSkills: string[]) => void
  onStop: () => void
}) {
  const [input, setInput] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const resizeDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const sendShortcut = useSettingsStore((s) => s.sendShortcut ?? 'enter')

  useEffect(() => {
    setInput('')
    setSelectedSkills([])
    setSkillPickerOpen(false)
  }, [sessionId])

  const resizeTextarea = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const currentHeight = textarea.getBoundingClientRect().height || 40
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, currentHeight, 40), 240)}px`
  }

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const textarea = textareaRef.current
    if (!textarea) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: textarea.getBoundingClientRect().height || 40,
    }
  }

  const continueResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current
    const textarea = textareaRef.current
    if (!drag || !textarea || drag.pointerId !== event.pointerId) return
    const nextHeight = Math.min(Math.max(drag.startHeight + drag.startY - event.clientY, 40), 240)
    textarea.style.height = `${nextHeight}px`
  }

  const endResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeDragRef.current?.pointerId !== event.pointerId) return
    resizeDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const mentionedSkills = useMemo(() => {
    const available = new Set(availableSkills)
    return Array.from(input.matchAll(/(?:^|\s)\$([A-Za-z0-9][A-Za-z0-9._-]*)/g))
      .map((match) => match[1])
      .filter((name) => available.has(name))
  }, [availableSkills, input])

  const sendCurrent = () => {
    const text = input.trim()
    if (!text || !sessionId) return
    onSend(text, Array.from(new Set([...selectedSkills, ...mentionedSkills])))
    setInput('')
    setSelectedSkills([])
    if (textareaRef.current) textareaRef.current.style.height = '40px'
  }

  const filteredSkills = availableSkills
    .filter((name) => !selectedSkills.includes(name))
    .filter((name) => name.toLowerCase().includes(skillQuery.trim().toLowerCase()))
    .slice(0, 12)

  return (
    <div className="p-3 border-t border-[var(--color-border)] shrink-0">
      {selectedSkills.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedSkills.map((skill) => (
            <button
              key={skill}
              type="button"
              onClick={() => setSelectedSkills((current) => current.filter((item) => item !== skill))}
              className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] text-[var(--color-accent)]"
              title={t('removeSkill', lang)}
            >
              ${skill} ×
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="relative self-end">
          <button
            type="button"
            disabled={!sessionId || isStopping}
            onClick={() => setSkillPickerOpen((open) => !open)}
            className="h-10 rounded-lg border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
            title={t('selectSkill', lang)}
          >
            $ Skill
          </button>
          {skillPickerOpen && (
            <div className="absolute bottom-12 left-0 z-30 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 shadow-xl">
              <input
                autoFocus
                value={skillQuery}
                onChange={(event) => setSkillQuery(event.target.value)}
                placeholder={t('searchSkills', lang)}
                className="mb-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
              />
              <div className="max-h-48 overflow-y-auto">
                {filteredSkills.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">{t('noSkillsFound', lang)}</p>
                ) : filteredSkills.map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => {
                      setSelectedSkills((current) => [...current, skill])
                      setSkillQuery('')
                      setSkillPickerOpen(false)
                    }}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--color-bg-hover)]"
                  >
                    ${skill}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="relative min-w-0 flex-1 self-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              requestAnimationFrame(resizeTextarea)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              const shouldSend = sendShortcut === 'enter' ? !e.shiftKey : e.shiftKey
              if (e.key === 'Enter' && shouldSend) {
                e.preventDefault()
                sendCurrent()
              }
            }}
            placeholder={sessionId
              ? t(sendShortcut === 'enter' ? 'typeMessage' : 'typeMessageShiftEnter', lang)
              : t('selectProjectFirst', lang)}
            disabled={!sessionId || isStopping}
            rows={1}
            className="block h-10 min-h-10 max-h-[240px] w-full overflow-y-auto resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 pr-8 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          <button
            type="button"
            aria-label={t('resizeMessageInput', lang)}
            title={t('resizeMessageInput', lang)}
            disabled={!sessionId || isStopping}
            onPointerDown={beginResize}
            onPointerMove={continueResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute right-1.5 top-1 cursor-ns-resize select-none rounded p-1 text-[var(--color-text-muted)] opacity-50 hover:bg-[var(--color-bg-hover)] hover:opacity-90 disabled:pointer-events-none"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 14 14"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 2.25h7.25a2.5 2.5 0 0 1 2.5 2.5V12" />
              <path d="M5.25 5.25h2.5a1.25 1.25 0 0 1 1.25 1.25V9" />
            </svg>
          </button>
        </div>
        <button
          onClick={sendCurrent}
          disabled={!sessionId || isStopping}
          className="h-10 px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors shrink-0 disabled:opacity-50"
        >
          {t('send', lang)}
        </button>
        <button
          onClick={onStop}
          disabled={!sessionId || isStopping}
          title={isStreaming ? t('stopCurrentTask', lang) : t('cancelAutoOrStop', lang)}
          className="h-10 px-3 py-2 rounded-lg bg-red-500/15 text-red-400 text-sm font-medium hover:bg-red-500/25 transition-colors shrink-0 disabled:opacity-50"
        >
          {isStopping ? t('stopping', lang) : t('stop', lang)}
        </button>
      </div>
    </div>
  )
}

export function AgentPanel() {
  const { connected, logsByProject, hydrateLogs, streamingBySession, stoppingBySession } = useAgentStore()
  const showProgressMessages = useSettingsStore((s) => s.showProgressMessages)
  const showToolCallHistory = useSettingsStore((s) => s.showToolCallHistory ?? false)
  const lang = useSettingsStore((s) => s.language)
  const appMode = useProjectStore((s) => s.appMode)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const mode = useProjectStore((s) => s.mode)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const touchChat = useChatStore((s) => s.touchChat)
  const openNewProject = useUiStore((s) => s.openNewProject)
  const isChat = appMode === 'normal'
  // The active surface is either a research project or a Quick Chat thread.
  const sessionId = isChat ? activeChatId : selectedTaskId
  // Auto / manual is a project-mode concept — in chat the toggle
  // is hidden, so the AUTO badge in the header should be hidden too.
  const isAuto = appMode === 'project' && mode === 'auto'

  const logs = sessionId ? (logsByProject[sessionId] ?? []) : []
  // Streaming is tracked per session so a different session's activity never
  // lights up this panel (e.g. a freshly created chat).
  const isStreaming = Boolean(sessionId && streamingBySession[sessionId])
  const isStopping = Boolean(sessionId && stoppingBySession[sessionId])
  const skillPlugins = useSkillPluginsStore((s) => s.plugins)
  const loadSkillPlugins = useSkillPluginsStore((s) => s.load)
  const activeTurnIds = useRef<Record<string, string>>({})
  const availableSkills = useMemo(() => Array.from(new Set(
    skillPlugins.flatMap((plugin) => plugin.enabled.effective
      ? plugin.skills.filter((skill) => skill.enabled.effective).map((skill) => skill.name)
      : []),
  )).sort(), [skillPlugins])

  useEffect(() => {
    if (connected) void loadSkillPlugins(GLOBAL_SKILLS_SESSION_ID)
  }, [connected, loadSkillPlugins])
  // Once tokens are actively streaming into the last entry, the growing bubble
  // is the activity indicator — drop the separate "thinking" dots so they don't
  // sit redundantly beneath the live reply.
  const lastEntry = logs[logs.length - 1]
  const isStreamingEntryLive = lastEntry?.type === 'response' && lastEntry.metadata?._streaming === true
  const showThinking = isStreaming && !isStreamingEntryLive
  // Surface the current task (e.g. latest tool call) so the indicator proves
  // Mira is actively working rather than a static "thinking" spinner.
  const activityLabel = useMemo(() => deriveActivityLabel(logs), [logs])

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
      if (entry.type === 'tool_call' && !showToolCallHistory) {
        continue
      }
      if (entry.type === 'progress' || entry.type === 'tool_call') {
        activityBuffer.push(entry)
        continue
      }
      flushActivity()
      items.push({ kind: 'entry', entry })
    }
    flushActivity()
    return items
  }, [logs, showToolCallHistory])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length, showThinking])

  useEffect(() => {
    setCollapsedProgressGroups({})
  }, [showProgressMessages, sessionId])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    void (async () => {
      const history = await fetchSessionHistory(sessionId)
      if (cancelled || history.length === 0) return
      hydrateLogs(sessionId, history)
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, hydrateLogs])

  useEffect(() => {
    if (!connected || !sessionId) return
    // Re-bind current session after websocket reconnects so progress streaming resumes.
    wsClient.send({
      type: 'bind',
      content: '',
      session_id: sessionId,
      user_id: 'ui_user',
    })
  }, [connected, sessionId])

  const handleSend = (text: string, selectedSkills: string[] = []) => {
    if (!sessionId) return
    if (isChat) touchChat(sessionId, text)
    useAgentStore.getState().addLog(sessionId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: text,
      type: 'response',
      metadata: { _user: true },
    })
    if (connected) {
      useAgentStore.getState().markSessionPending(sessionId)
    }

    const { mode: currentMode, agentProfile: currentAgentProfile } = useProjectStore.getState()
    const turnId = createClientId('turn')
    activeTurnIds.current[sessionId] = turnId
    wsClient.send({
      type: 'message',
      content: text,
      session_id: sessionId,
      user_id: 'ui_user',
      loop_mode: appMode,
      stream: useSettingsStore.getState().streamResponses,
      turn_id: turnId,
      selected_skill_ids: selectedSkills,
      ...(appMode === 'project' && {
        mode: currentMode,
        agent_profile: currentAgentProfile,
      }),
    })
  }

  const handleResend = (content: string) => {
    if (!sessionId) return

    useAgentStore.getState().addLog(sessionId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content,
      type: 'response',
      metadata: { _user: true },
    })
    if (connected) {
      useAgentStore.getState().markSessionPending(sessionId)
    }

    const { mode: currentMode, agentProfile: currentAgentProfile } = useProjectStore.getState()
    wsClient.send({
      type: 'message',
      content,
      session_id: sessionId,
      user_id: 'ui_user',
      loop_mode: appMode,
      stream: useSettingsStore.getState().streamResponses,
      ...(appMode === 'project' && {
        mode: currentMode,
        agent_profile: currentAgentProfile,
      }),
    })
  }

  const handleStop = () => {
    if (!sessionId) return
    useAgentStore.getState().markSessionStopping(sessionId)

    wsClient.send({
      type: 'stop',
      content: '',
      session_id: sessionId,
      user_id: 'ui_user',
      loop_mode: appMode,
      turn_id: activeTurnIds.current[sessionId],
      request_id: createClientId('stop'),
    })
  }

  const handleSkillFallback = (approved: boolean, skillIds: string[]) => {
    if (!sessionId) return
    if (approved) useAgentStore.getState().markSessionPending(sessionId)
    wsClient.send({
      type: 'skill_fallback_response',
      content: '',
      session_id: sessionId,
      user_id: 'ui_user',
      loop_mode: appMode,
      approved,
      selected_skill_ids: skillIds,
      turn_id: createClientId('turn'),
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
        {sessionId && isChat && (
          <button
            onClick={() => openNewProject({ prefill: buildPromotePrefill(logs), fromChatId: sessionId })}
            title={t('promoteToProjectHint', lang)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
            {t('promoteToProject', lang)}
          </button>
        )}
        {sessionId && appMode === 'project' && (
          <span className="ml-auto text-[10px] font-mono text-[var(--color-text-muted)]">
            {sessionId}
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
          const requiresSkillFallback = entry.metadata?._skill_fallback_required === true
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
          if (requiresSkillFallback) {
            const rawSkills = entry.metadata?.selected_skill_ids
            const skillIds = Array.isArray(rawSkills)
              ? rawSkills.filter((item): item is string => typeof item === 'string')
              : []
            return (
              <div key={entry.id} className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)]">{entry.content}</p>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('skillFallbackPrompt', lang)}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSkillFallback(true, skillIds)}
                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white"
                  >
                    {t('approveFallback', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkillFallback(false, skillIds)}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs"
                  >
                    {t('rejectFallback', lang)}
                  </button>
                </div>
              </div>
            )
          }
          return <LogEntry key={entry.id} entry={entry} />
        })}

        {showThinking && (
          <div className="px-4 py-2" role="status" aria-live="polite">
            <div className="inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:240ms]" />
              </span>
              <span className="min-w-0 truncate whitespace-nowrap">
                {activityLabel ? t('miraRunningStep', lang, { step: activityLabel }) : t('miraThinking', lang)}
              </span>
            </div>
          </div>
        )}

        {logs.length === 0 && !showThinking && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs">
              {sessionId ? t(isChat ? 'sendNormalMessageToStart' : 'sendMessageToStart', lang) : t('selectProjectFirst', lang)}
            </span>
          </div>
        )}
      </div>

      <ChatComposer
        sessionId={sessionId}
        isStreaming={isStreaming}
        isStopping={isStopping}
        availableSkills={availableSkills}
        lang={lang}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  )
}
