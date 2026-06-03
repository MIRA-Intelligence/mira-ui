import { describe, expect, it } from 'vitest'

import { compareVersions, isNewer, isPrerelease, parseVersion } from './version'

describe('parseVersion', () => {
  it.each([
    ['v0.3.0', { major: 0, minor: 3, patch: 0, prerelease: null }],
    ['0.3.0', { major: 0, minor: 3, patch: 0, prerelease: null }],
    ['v1.10.2', { major: 1, minor: 10, patch: 2, prerelease: null }],
    ['v0.3.0rc10', { major: 0, minor: 3, patch: 0, prerelease: { label: 'rc', number: 10 } }],
    ['0.3.0-rc.10', { major: 0, minor: 3, patch: 0, prerelease: { label: 'rc', number: 10 } }],
    ['v0.3.0-beta.2', { major: 0, minor: 3, patch: 0, prerelease: { label: 'beta', number: 2 } }],
    ['v0.3.0-rc1', { major: 0, minor: 3, patch: 0, prerelease: { label: 'rc', number: 1 } }],
  ])('parses %s', (input, expected) => {
    const parsed = parseVersion(input)
    expect(parsed).not.toBeNull()
    expect(parsed!.major).toBe(expected.major)
    expect(parsed!.minor).toBe(expected.minor)
    expect(parsed!.patch).toBe(expected.patch)
    expect(parsed!.prerelease).toEqual(expected.prerelease)
  })

  it.each(['', 'foo', 'v1', '1.2', '1.2.3.4', 'v1.2.3-foo-bar'])(
    'rejects malformed %s',
    (input) => {
      expect(parseVersion(input)).toBeNull()
    },
  )
})

describe('compareVersions', () => {
  it('orders by major then minor then patch', () => {
    expect(compareVersions(parseVersion('v0.3.0')!, parseVersion('v0.4.0')!)).toBe(-1)
    expect(compareVersions(parseVersion('v0.4.0')!, parseVersion('v0.3.9')!)).toBe(1)
    expect(compareVersions(parseVersion('v1.0.0')!, parseVersion('v0.99.99')!)).toBe(1)
    expect(compareVersions(parseVersion('v0.3.0')!, parseVersion('v0.3.0')!)).toBe(0)
  })

  it('treats stable as newer than the matching prerelease', () => {
    expect(compareVersions(parseVersion('v0.3.0')!, parseVersion('v0.3.0rc10')!)).toBe(1)
    expect(compareVersions(parseVersion('v0.3.0rc10')!, parseVersion('v0.3.0')!)).toBe(-1)
  })

  it('orders prereleases by their numeric suffix', () => {
    expect(compareVersions(parseVersion('v0.3.0rc9')!, parseVersion('v0.3.0rc10')!)).toBe(-1)
    expect(compareVersions(parseVersion('v0.3.0-rc.10')!, parseVersion('v0.3.0-rc.11')!)).toBe(-1)
  })
})

describe('isNewer', () => {
  it('flags strictly-newer stable releases', () => {
    expect(isNewer('v0.4.0', '0.3.0')).toBe(true)
    expect(isNewer('v0.3.0', '0.3.0')).toBe(false)
    expect(isNewer('v0.2.9', '0.3.0')).toBe(false)
  })

  it('flags stable as newer than the matching prerelease', () => {
    expect(isNewer('v0.3.0', '0.3.0-rc.10')).toBe(true)
  })

  it('flags higher rc as newer than lower rc', () => {
    expect(isNewer('v0.3.0rc11', '0.3.0-rc.10')).toBe(true)
  })

  it('returns false for unparseable inputs', () => {
    expect(isNewer('not-a-version', '0.3.0')).toBe(false)
    expect(isNewer('v0.4.0', 'garbage')).toBe(false)
  })
})

describe('isPrerelease', () => {
  it('detects rc / beta tags as prereleases', () => {
    expect(isPrerelease('v0.3.0rc10')).toBe(true)
    expect(isPrerelease('v0.3.0-beta.2')).toBe(true)
  })

  it('treats clean X.Y.Z as stable', () => {
    expect(isPrerelease('v0.3.0')).toBe(false)
    expect(isPrerelease('0.3.0')).toBe(false)
  })
})
