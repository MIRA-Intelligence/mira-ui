import { describe, expect, it } from 'vitest'

import {
  isRuntimePreferenceSwitchBlocked,
  runtimePreferenceSwitchBlockTitle,
} from './runtimePreferencesGuard'

describe('runtimePreferencesGuard', () => {
  it('blocks only while streaming', () => {
    expect(isRuntimePreferenceSwitchBlocked(false)).toBe(false)
    expect(isRuntimePreferenceSwitchBlocked(true)).toBe(true)
  })

  it('returns a streaming hint for tooltips', () => {
    expect(runtimePreferenceSwitchBlockTitle('en', false, 'profile')).toBeUndefined()
    expect(runtimePreferenceSwitchBlockTitle('en', true, 'profile')).toContain('Stop')
  })
})
