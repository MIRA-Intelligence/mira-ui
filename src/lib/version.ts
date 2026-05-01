// Tiny semver implementation tailored to the MIRA release tag conventions.
// Tag examples observed on GitHub:
//   v0.3.0          → stable
//   v0.3.0rc10      → release candidate (no separator before "rc")
//   v0.3.0-rc.10    → semver-canonical prerelease (what package.json carries)
//   0.3.0           → bare semver
// We only need: parsing → struct, ordering, prerelease detection.

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  // null = stable. Otherwise the prerelease label (e.g. "rc", "beta") and
  // its numeric suffix. We keep the original tag too so callers can echo it
  // back to the user without re-formatting decisions.
  prerelease: { label: string; number: number } | null
  raw: string
}

const VERSION_REGEX =
  /^v?(\d+)\.(\d+)\.(\d+)(?:[-.]?([A-Za-z]+)\.?(\d+))?$/

export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = VERSION_REGEX.exec(trimmed)
  if (!match) return null
  const [, maj, min, pat, label, num] = match
  return {
    major: Number(maj),
    minor: Number(min),
    patch: Number(pat),
    prerelease: label ? { label: label.toLowerCase(), number: Number(num ?? '0') } : null,
    raw: trimmed,
  }
}

export function isPrerelease(v: ParsedVersion | string): boolean {
  if (typeof v === 'string') {
    const parsed = parseVersion(v)
    return parsed ? parsed.prerelease !== null : false
  }
  return v.prerelease !== null
}

// Returns -1 if a < b, 0 if equal, 1 if a > b.
export function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  // Same X.Y.Z: stable beats any prerelease.
  if (!a.prerelease && b.prerelease) return 1
  if (a.prerelease && !b.prerelease) return -1
  if (!a.prerelease && !b.prerelease) return 0
  // Both prereleases.
  const ap = a.prerelease!
  const bp = b.prerelease!
  if (ap.label !== bp.label) return ap.label < bp.label ? -1 : 1
  if (ap.number !== bp.number) return ap.number < bp.number ? -1 : 1
  return 0
}

// Convenience: returns true iff `candidate` is strictly newer than `current`.
export function isNewer(candidate: string, current: string): boolean {
  const c = parseVersion(candidate)
  const cur = parseVersion(current)
  if (!c || !cur) return false
  return compareVersions(c, cur) === 1
}
