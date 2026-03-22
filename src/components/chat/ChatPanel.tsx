import { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore } from '@/stores/uiStore'
import { wsClient } from '@/services/websocket'

export function ChatPanel() {
  const [input, setInput] = useState('')
  const { logs, connected } = useAgentStore()
  const { toggleChat } = useUiStore()
  const listRef = useRef<HTMLDivElement>(null)

  const chatLogs = logs.filter((l) => l.type === 'response' || l.metadata?._user)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [chatLogs.length])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return

    useAgentStore.getState().addLog({
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: text,
      type: 'response',
      metadata: { _user: true },
    })

    wsClient.send({
      type: 'message',
      content: text,
      session_id: 'ui',
      user_id: 'ui_user',
    })
    setInput('')
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Agent Chat</span>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
        </div>
        <button
          onClick={toggleChat}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors p-1"
          aria-label="Close chat"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {chatLogs.map((log) => {
          const isUser = !!log.metadata?._user
          return (
            <div
              key={log.id}
              className={`text-sm rounded-lg p-2.5 leading-relaxed max-w-[90%] whitespace-pre-wrap ${
                isUser
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-text-primary)] ml-auto'
                  : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
              }`}
            >
              {log.content}
            </div>
          )
        })}
        {chatLogs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs">Send a message to chat with the agent</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[var(--color-border)] shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            className="flex-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
          />
          <button
            onClick={handleSend}
            className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
