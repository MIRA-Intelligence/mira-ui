import { describe, expect, it } from 'vitest'

import { parseDelimited } from './parseDelimited'

describe('parseDelimited', () => {
  it('parses a simple CSV', () => {
    const out = parseDelimited('a,b,c\n1,2,3\n4,5,6\n')
    expect(out.truncated).toBe(false)
    expect(out.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('handles trailing row without newline', () => {
    const out = parseDelimited('a,b\n1,2')
    expect(out.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('honors quoted fields with embedded delimiter, quote, and newline', () => {
    const out = parseDelimited('a,b\n"hello, world","line1\nline2"\n"He said ""hi""",x')
    expect(out.rows).toEqual([
      ['a', 'b'],
      ['hello, world', 'line1\nline2'],
      ['He said "hi"', 'x'],
    ])
  })

  it('accepts CRLF line endings', () => {
    const out = parseDelimited('a,b\r\n1,2\r\n3,4\r\n')
    expect(out.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('parses TSV when delimiter is overridden', () => {
    const out = parseDelimited('a\tb\n1\t2', { delimiter: '\t' })
    expect(out.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('caps rows at maxRows and reports truncation', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i},${i * 2}`).join('\n')
    const out = parseDelimited(lines, { maxRows: 3 })
    expect(out.truncated).toBe(true)
    expect(out.rows.length).toBe(3)
    expect(out.rows[0]).toEqual(['0', '0'])
  })

  it('returns no rows for empty input', () => {
    expect(parseDelimited('')).toEqual({ rows: [], truncated: false })
  })
})
