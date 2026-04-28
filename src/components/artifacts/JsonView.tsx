import { Fragment, useMemo, useState } from 'react'

interface JsonViewProps {
  text: string
  // How many levels are expanded by default. Deeper nodes start collapsed.
  defaultExpandDepth?: number
}

export function JsonView({ text, defaultExpandDepth = 2 }: JsonViewProps) {
  const parsed = useMemo<{ value: unknown; error: string | null; ndjson: boolean }>(() => {
    const trimmed = text.trim()
    if (!trimmed) return { value: null, error: null, ndjson: false }
    // Single JSON document.
    try {
      return { value: JSON.parse(trimmed), error: null, ndjson: false }
    } catch {
      // NDJSON / JSONL fallback: parse line-by-line into an array.
      const lines = trimmed.split('\n').filter((l) => l.trim().length > 0)
      const out: unknown[] = []
      for (const line of lines) {
        try {
          out.push(JSON.parse(line))
        } catch (e) {
          return {
            value: null,
            error: `Invalid JSON: ${(e as Error).message}`,
            ndjson: false,
          }
        }
      }
      return { value: out, error: null, ndjson: true }
    }
  }, [text])

  if (parsed.error) {
    return (
      <pre className="text-xs text-[var(--color-error)] whitespace-pre-wrap font-mono">
        {parsed.error}
      </pre>
    )
  }

  return (
    <div className="font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)]">
      {parsed.ndjson && (
        <div className="mb-1 text-[10px] text-[var(--color-text-muted)]">
          Parsed as NDJSON ({Array.isArray(parsed.value) ? parsed.value.length : 0} records)
        </div>
      )}
      <Node value={parsed.value} depth={0} defaultExpandDepth={defaultExpandDepth} />
    </div>
  )
}

function Node({
  value,
  depth,
  defaultExpandDepth,
}: {
  value: unknown
  depth: number
  defaultExpandDepth: number
}) {
  if (value === null) return <span className="text-[var(--color-text-muted)]">null</span>
  if (typeof value === 'boolean')
    return <span className="text-[var(--color-accent)]">{String(value)}</span>
  if (typeof value === 'number')
    return <span className="text-[var(--color-accent)]">{value}</span>
  if (typeof value === 'string')
    return (
      <span className="text-[var(--color-success)] break-all">"{escapeString(value)}"</span>
    )
  if (Array.isArray(value)) {
    return <Collapsible
      depth={depth}
      defaultExpandDepth={defaultExpandDepth}
      summary={<span className="text-[var(--color-text-muted)]">[ {value.length} items ]</span>}
      open={<>
        <Bracket text="[" />
        <ul className="pl-4 border-l border-[var(--color-border)] ml-1">
          {value.map((v, i) => (
            <li key={i} className="flex">
              <span className="text-[var(--color-text-muted)] mr-2 select-none">{i}:</span>
              <Node value={v} depth={depth + 1} defaultExpandDepth={defaultExpandDepth} />
              {i < value.length - 1 && <span>,</span>}
            </li>
          ))}
        </ul>
        <Bracket text="]" />
      </>}
    />
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return <Collapsible
      depth={depth}
      defaultExpandDepth={defaultExpandDepth}
      summary={<span className="text-[var(--color-text-muted)]">{`{ ${entries.length} keys }`}</span>}
      open={<>
        <Bracket text="{" />
        <ul className="pl-4 border-l border-[var(--color-border)] ml-1">
          {entries.map(([k, v], i) => (
            <li key={k} className="flex">
              <span className="text-[var(--color-text-secondary)] mr-2">"{k}":</span>
              <Node value={v} depth={depth + 1} defaultExpandDepth={defaultExpandDepth} />
              {i < entries.length - 1 && <span>,</span>}
            </li>
          ))}
        </ul>
        <Bracket text="}" />
      </>}
    />
  }
  return <span>{String(value)}</span>
}

function Collapsible({
  depth,
  defaultExpandDepth,
  summary,
  open,
}: {
  depth: number
  defaultExpandDepth: number
  summary: React.ReactNode
  open: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth)
  return (
    <div className="inline-block align-top">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[var(--color-text-muted)] mr-1 select-none hover:text-[var(--color-text-secondary)]"
        aria-expanded={expanded}
      >
        {expanded ? '▼' : '▶'}
      </button>
      {expanded ? <Fragment>{open}</Fragment> : summary}
    </div>
  )
}

function Bracket({ text }: { text: string }) {
  return <span className="text-[var(--color-text-muted)]">{text}</span>
}

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}
