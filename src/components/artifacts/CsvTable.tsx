import { useMemo } from 'react'

import { parseDelimited } from './parseDelimited'

interface CsvTableProps {
  text: string
  delimiter?: string
  truncatedLabel?: string
}

const ROW_CAP = 1000

export function CsvTable({ text, delimiter = ',', truncatedLabel }: CsvTableProps) {
  const { rows, truncated } = useMemo(
    () => parseDelimited(text, { delimiter, maxRows: ROW_CAP + 1 }),
    [text, delimiter],
  )

  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)] italic">Empty file.</p>
    )
  }

  const [header, ...body] = rows
  const visibleBody = body.slice(0, ROW_CAP)
  const overflow = truncated || body.length > ROW_CAP

  return (
    <div className="text-xs">
      <div className="max-h-[420px] overflow-auto rounded-md border border-[var(--color-border)]">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 bg-[var(--color-bg-secondary)]">
            <tr>
              <th className="text-right px-2 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)] border-b border-[var(--color-border)] sticky left-0 bg-[var(--color-bg-secondary)]">
                #
              </th>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="text-left px-2 py-1.5 font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border)] whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBody.map((row, rIdx) => (
              <tr key={rIdx} className="odd:bg-[var(--color-bg-primary)] even:bg-[var(--color-bg-secondary)]/40">
                <td className="text-right px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] sticky left-0 bg-inherit">
                  {rIdx + 1}
                </td>
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className="px-2 py-1 align-top text-[var(--color-text-primary)] whitespace-pre-wrap break-words"
                    title={cell.length > 80 ? cell : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-text-muted)] flex justify-between">
        <span>
          {visibleBody.length} row{visibleBody.length === 1 ? '' : 's'} ·{' '}
          {header.length} column{header.length === 1 ? '' : 's'}
        </span>
        {overflow && (
          <span className="text-[var(--color-warning)]">
            {truncatedLabel ?? `Showing first ${ROW_CAP} rows — download to see the full file.`}
          </span>
        )}
      </div>
    </div>
  )
}
