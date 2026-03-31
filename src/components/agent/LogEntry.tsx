import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import type { LogEntry as LogEntryType } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/stores/projectStore'
import { useHarnessStore } from '@/stores/harnessStore'

interface LogEntryProps {
  entry: LogEntryType
  defaultCollapsed?: boolean
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="mb-1">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] underline underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.startsWith('language-')
          if (isBlock) {
            return (
              <code className="block overflow-x-auto rounded-md bg-[var(--color-bg-tertiary)] px-3 py-2 font-mono text-xs">
                {children}
              </code>
            )
          }
          return (
            <code className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="mb-2">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-text-muted)]">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-2 border-[var(--color-border)]" />,
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-[var(--color-border)]">{children}</thead>,
        th: ({ children }) => <th className="px-2 py-1 text-left font-medium text-[var(--color-text-muted)]">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export function LogEntry({ entry, defaultCollapsed = false }: LogEntryProps) {
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const setActiveStage = useProjectStore((s) => s.setActiveStage)
  const focusRun = useHarnessStore((s) => s.focusRun)
  const [collapsed, setCollapsed] = useState(entry.collapsed ?? defaultCollapsed)
  const runId = typeof entry.metadata?._run_id === 'string' ? entry.metadata._run_id : null

  useEffect(() => {
    setCollapsed(entry.collapsed ?? defaultCollapsed)
  }, [entry.id, entry.collapsed, defaultCollapsed])

  if (entry.type === 'tool_call') {
    return (
      <div className="px-4 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <span>{collapsed ? '▷' : '▽'}</span>
          <span>Worked for &lt;1s</span>
        </button>
        {!collapsed && (
          <div className="mt-1 ml-4 flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-muted)]">🔧</span>
            <span className="px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] font-mono">
              {entry.content}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (entry.type === 'progress') {
    const preview = entry.content.split('\n')[0] || 'Progress update'
    return (
      <div className="px-4 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full text-left flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <span>{collapsed ? '▷' : '▽'}</span>
          <span className="font-mono">{formatTime(entry.timestamp)}</span>
          <span className="uppercase tracking-wide">Progress</span>
          {collapsed && (
            <span className="truncate">- {preview}</span>
          )}
        </button>
        {!collapsed && (
          <div className="mt-1 ml-4 text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-text-secondary)]">
            {entry.content}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-2">
      <div className="text-xs text-[var(--color-text-muted)] mb-1 font-mono">
        {formatTime(entry.timestamp)}
      </div>
      <div
        className={cn(
          'text-sm leading-relaxed break-words',
          entry.type === 'error'
            ? 'text-red-400'
            : 'text-[var(--color-text-secondary)]',
        )}
      >
        {entry.type === 'response' ? <MarkdownContent content={entry.content} /> : entry.content}
      </div>
      {entry.type === 'response' && runId && selectedTaskId && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className="font-mono text-[var(--color-text-muted)]">run: {runId}</span>
          <button
            onClick={() => {
              focusRun(selectedTaskId, runId)
              setActiveStage('result')
            }}
            className="px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
          >
            View Trace
          </button>
        </div>
      )}
    </div>
  )
}
