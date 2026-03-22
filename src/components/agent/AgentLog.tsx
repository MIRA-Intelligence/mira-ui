import { useEffect, useRef } from 'react'
import { useAgentStore } from '@/stores/agentStore'
import { mockLogs } from '@/stores/mockData'
import { JobMonitor } from './JobMonitor'
import { LogEntry } from './LogEntry'

export function AgentLog() {
  const { logs, connected } = useAgentStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const displayLogs = logs.length > 0 ? logs : mockLogs

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayLogs.length])

  return (
    <div className="flex flex-col h-full">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <JobMonitor jobId="dlc5mf37te3ly2uf" />

      <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]/30">
        {displayLogs.map((entry) => (
          <LogEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
