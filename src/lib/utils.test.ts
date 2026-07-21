import { describe, expect, it } from 'vitest'

import { cn, formatNumber, formatTime } from './utils'

describe('cn', () => {
  it('joins truthy class values', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })

  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})

describe('formatNumber', () => {
  it('formats billions', () => {
    expect(formatNumber(2_500_000_000)).toBe('2.50B')
  })

  it('formats millions', () => {
    expect(formatNumber(1_500_000)).toBe('1.5M')
  })

  it('formats thousands', () => {
    expect(formatNumber(12_345)).toBe('12K')
  })

  it('returns small numbers as-is', () => {
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(0)).toBe('0')
  })
})

describe('formatTime', () => {
  it('produces a 24-hour HH:MM string', () => {
    expect(formatTime('2026-01-02T08:05:00Z')).toMatch(/^\d{2}:\d{2}$/)
  })
})
