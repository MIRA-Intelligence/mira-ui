import { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useAutoContinue } from '@/hooks/useAutoContinue'
import { wsClient } from '@/services/websocket'
import { LogEntry } from './LogEntry'

const AUTO_DELAY_MS = 4000

export function AgentPanel() {
  const { connected, logsByProject } = useAgentStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const { countdown, cancel: cancelAuto, isAuto } = useAutoContinue()

  const logs = selectedTaskId ? (logsByProject[selectedTaskId] ?? []) : []

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length])

  const handleSend = () => {
    const text = input.trim()
    if (!text || !selectedTaskId) return

    cancelAuto()

    useAgentStore.getState().addLog(selectedTaskId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: text,
      type: 'response',
      metadata: { _user: true },
    })

    wsClient.send({
      type: 'message',
      content: text,
      session_id: selectedTaskId,
      user_id: 'ui_user',
    })
    setInput('')
  }

  const handleResend = (content: string) => {
    if (!selectedTaskId) return
    cancelAuto()

    useAgentStore.getState().addLog(selectedTaskId, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content,
      type: 'response',
      metadata: { _user: true },
    })

    wsClient.send({
      type: 'message',
      content,
      session_id: selectedTaskId,
      user_id: 'ui_user',
    })
  }

  const countdownProgress = countdown !== null
    ? Math.max(0, countdown / AUTO_DELAY_MS)
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Agent
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {connected ? 'Connected' : 'Disconnected'}
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
        {logs.map((entry) => {
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
                    title="Resend"
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
              {selectedTaskId ? 'Send a message to start' : 'Select a project first'}
            </span>
          </div>
        )}
      </div>

      {/* Auto-continue countdown */}
      {countdownProgress !== null && (
        <div className="px-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-success)]/8 border border-[var(--color-success)]/20">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[var(--color-success)] font-medium">
                  Auto-continuing in {Math.ceil((countdown ?? 0) / 1000)}s...
                </span>
                <button
                  onClick={cancelAuto}
                  className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
              <div className="h-1 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-success)] rounded-full transition-all duration-75 ease-linear"
                  style={{ width: `${(1 - countdownProgress) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-[var(--color-border)] shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={selectedTaskId ? 'Type a message...' : 'Select a project first'}
            disabled={!selectedTaskId}
            className="flex-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!selectedTaskId}
            className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors shrink-0 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
