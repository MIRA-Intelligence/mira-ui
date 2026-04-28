import { useMemo } from 'react'

interface TextViewProps {
  text: string
  showLineNumbers?: boolean
  maxLines?: number
  truncatedLabel?: string
}

const DEFAULT_MAX_LINES = 2000

export function TextView({
  text,
  showLineNumbers = true,
  maxLines = DEFAULT_MAX_LINES,
  truncatedLabel,
}: TextViewProps) {
  const { lines, truncated } = useMemo(() => {
    const all = text.split('\n')
    if (all.length <= maxLines) return { lines: all, truncated: false }
    return { lines: all.slice(0, maxLines), truncated: true }
  }, [text, maxLines])

  return (
    <div className="text-xs">
      <div className="max-h-[420px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
        <pre className="m-0 p-0 font-mono text-[12px] leading-[1.5] text-[var(--color-text-primary)]">
          {showLineNumbers ? (
            <table className="border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="select-none text-right pr-3 pl-2 align-top text-[10px] text-[var(--color-text-muted)] border-r border-[var(--color-border)] sticky left-0 bg-[var(--color-bg-primary)]">
                      {i + 1}
                    </td>
                    <td className="pl-3 pr-2 whitespace-pre">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <code className="block px-3 py-2 whitespace-pre">{lines.join('\n')}</code>
          )}
        </pre>
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-text-muted)] flex justify-between">
        <span>{lines.length} lines</span>
        {truncated && (
          <span className="text-[var(--color-warning)]">
            {truncatedLabel ?? `Showing first ${maxLines} lines — download to see the full file.`}
          </span>
        )}
      </div>
    </div>
  )
}
