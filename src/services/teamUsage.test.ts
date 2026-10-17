import { describe, expect, it } from 'vitest'
import { formatTokens, parseTokens } from './teamUsage'

describe('token amounts', () => {
  it('parses what people write', () => {
    expect(parseTokens('2M')).toBe(2_000_000)
    expect(parseTokens(' 500k ')).toBe(500_000)
    expect(parseTokens('1,200,000')).toBe(1_200_000)
    expect(parseTokens('1.5m')).toBe(1_500_000)
    expect(parseTokens('')).toBeNull()
    expect(parseTokens('unlimited')).toBe(0)
    expect(parseTokens('不限')).toBe(0)
    expect(parseTokens('lots')).toBeUndefined()
    expect(parseTokens('-5')).toBeUndefined()
    expect(parseTokens('1.5')).toBeUndefined()
  })

  it('formats them compactly', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(9_999)).toBe('9,999')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(2_000_000)).toBe('2M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
    expect(formatTokens(150_000_000)).toBe('150M')
  })
})
