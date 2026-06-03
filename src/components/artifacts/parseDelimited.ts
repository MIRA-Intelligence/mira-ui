// Minimal RFC 4180 delimited-text parser. Supports:
//   - quoted fields with embedded delimiters and newlines
//   - "" → " escape inside quoted fields
//   - both LF and CRLF line endings
// Intended for CSV/TSV preview only — not a general-purpose CSV library.

export interface ParseDelimitedOptions {
  delimiter?: string
  // Soft cap on rows. The parser stops at the first row boundary after this
  // many rows are emitted and reports `truncated: true`. This keeps us from
  // pinning the renderer with a multi-million-row file.
  maxRows?: number
}

export interface ParseDelimitedResult {
  rows: string[][]
  truncated: boolean
}

const DEFAULT_MAX_ROWS = 5000

export function parseDelimited(
  input: string,
  options: ParseDelimitedOptions = {},
): ParseDelimitedResult {
  const delimiter = options.delimiter ?? ','
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = input.length

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    rows.push(row)
    row = []
  }

  while (i < len) {
    if (rows.length >= maxRows) {
      return { rows, truncated: true }
    }
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      pushField()
      pushRow()
      if (input[i + 1] === '\n') i += 2
      else i++
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }

  // Flush trailing field/row only if we actually saw content. This avoids
  // emitting a spurious empty row for files that end on a newline.
  if (field.length > 0 || row.length > 0) {
    pushField()
    pushRow()
  }

  return { rows, truncated: false }
}
