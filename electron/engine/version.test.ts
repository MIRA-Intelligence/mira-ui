import { describe, expect, it } from 'vitest'

import {
  compareEngineVersions,
  isRunningEngineStale,
  parseEngineVersion,
} from './version'

describe('parseEngineVersion', () => {
  it('parses a plain semver triple', () => {
    expect(parseEngineVersion('0.2.0')).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: '',
    })
  })

  it('parses pre-release tags attached without a separator (PEP 440 style)', () => {
    expect(parseEngineVersion('0.2.0rc4')).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: 'rc4',
    })
  })

  it('parses pre-release tags joined by a hyphen (semver style)', () => {
    expect(parseEngineVersion('1.4.2-beta.1')).toEqual({
      major: 1,
      minor: 4,
      patch: 2,
      prerelease: 'beta.1',
    })
  })

  it('strips a leading v prefix', () => {
    expect(parseEngineVersion('v3.0.1')).toEqual({
      major: 3,
      minor: 0,
      patch: 1,
      prerelease: '',
    })
  })

  it('lowercases the prerelease tag for stable comparison', () => {
    expect(parseEngineVersion('0.2.0RC4')?.prerelease).toBe('rc4')
  })

  it('returns null for empty and unparseable input', () => {
    expect(parseEngineVersion('')).toBeNull()
    expect(parseEngineVersion(null)).toBeNull()
    expect(parseEngineVersion(undefined)).toBeNull()
    expect(parseEngineVersion('not-a-version')).toBeNull()
  })
})

describe('compareEngineVersions', () => {
  const v = (input: string) => {
    const parsed = parseEngineVersion(input)
    if (!parsed) throw new Error(`failed to parse ${input}`)
    return parsed
  }

  it('orders by major, minor, patch numerically', () => {
    expect(compareEngineVersions(v('0.2.0'), v('0.3.0'))).toBeLessThan(0)
    expect(compareEngineVersions(v('1.0.0'), v('0.99.99'))).toBeGreaterThan(0)
    expect(compareEngineVersions(v('0.2.1'), v('0.2.0'))).toBeGreaterThan(0)
  })

  it('treats a pre-release tag as preceding the matching final release', () => {
    expect(compareEngineVersions(v('0.2.0rc4'), v('0.2.0'))).toBeLessThan(0)
    expect(compareEngineVersions(v('0.2.0'), v('0.2.0rc4'))).toBeGreaterThan(0)
  })

  it('orders pre-releases of the same core version lexically', () => {
    expect(compareEngineVersions(v('0.2.0rc3'), v('0.2.0rc4'))).toBeLessThan(0)
    expect(compareEngineVersions(v('0.2.0alpha'), v('0.2.0beta'))).toBeLessThan(0)
    expect(compareEngineVersions(v('0.2.0beta'), v('0.2.0rc1'))).toBeLessThan(0)
  })

  it('reports equality for identical inputs', () => {
    expect(compareEngineVersions(v('0.2.0rc4'), v('0.2.0rc4'))).toBe(0)
    expect(compareEngineVersions(v('1.0.0'), v('1.0.0'))).toBe(0)
  })
})

describe('isRunningEngineStale', () => {
  const BUNDLED = '0.2.0rc4'

  it('flags a missing running version as stale (almost certainly an old build)', () => {
    expect(isRunningEngineStale(null, BUNDLED)).toBe(true)
    expect(isRunningEngineStale(undefined, BUNDLED)).toBe(true)
    expect(isRunningEngineStale('   ', BUNDLED)).toBe(true)
  })

  it('returns false when the bundled version is itself unknown', () => {
    expect(isRunningEngineStale('0.1.0', null)).toBe(false)
    expect(isRunningEngineStale('0.1.0', '')).toBe(false)
  })

  it('returns false when running matches the bundle exactly', () => {
    expect(isRunningEngineStale('0.2.0rc4', BUNDLED)).toBe(false)
    expect(isRunningEngineStale('  0.2.0rc4 ', BUNDLED)).toBe(false)
  })

  it('flags a strictly older running engine as stale', () => {
    expect(isRunningEngineStale('0.1.5', BUNDLED)).toBe(true)
    expect(isRunningEngineStale('0.2.0rc3', BUNDLED)).toBe(true)
    expect(isRunningEngineStale('0.1.0', '0.2.0')).toBe(true)
  })

  it('does NOT flag a newer running engine as stale (developer override case)', () => {
    expect(isRunningEngineStale('0.3.0', BUNDLED)).toBe(false)
    expect(isRunningEngineStale('0.2.0', '0.2.0rc4')).toBe(false)
    expect(isRunningEngineStale('0.2.1', '0.2.0')).toBe(false)
  })

  it('falls back to strict mismatch when either side is unparseable', () => {
    // running shape unrecognisable but bundled is fine — be safe and replace.
    expect(isRunningEngineStale('garbage-build', BUNDLED)).toBe(true)
    // bundled shape unrecognisable: we have nothing to compare against, so
    // any non-equal running value is treated as stale.
    expect(isRunningEngineStale('0.2.0', 'mira-2026.04rc2')).toBe(true)
    // ...but exact-match strings short-circuit before parsing.
    expect(isRunningEngineStale('mira-2026.04rc2', 'mira-2026.04rc2')).toBe(false)
  })

  it('matches the production scenario: old launchd engine after bundle upgrade', () => {
    // User installed UI 0.3.0rc1 (bundled engine 0.1.5), then upgraded to
    // UI 0.3.0rc2 (bundled engine 0.2.0rc4). The old launchd-managed engine
    // is still answering on port 18790 with the old version.
    expect(isRunningEngineStale('0.1.5', '0.2.0rc4')).toBe(true)
  })
})
