/**
 * Pure version helpers for the local engine bootstrap.
 *
 * Used by the LocalEngineManager fast-path to decide whether the engine
 * already running on the gateway port belongs to the currently bundled
 * mira-engine, or whether it's a stale installation that must be torn down
 * before the bundled binary can take over.
 *
 * Kept side-effect-free so it can be unit tested without an Electron host.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Pre-release tag suffix, e.g. "rc4" for "0.2.0rc4" or "alpha.1". */
  prerelease: string
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[.-]?([0-9A-Za-z.-]+))?/

/**
 * Parse a permissive semver-ish string. Accepts shapes like:
 *   - "0.2.0", "v0.2.0"
 *   - "0.2.0rc4", "0.2.0-rc4"
 *   - "0.2.0.dev1"
 * Returns null when the input cannot even be reduced to a major.minor.patch
 * triple. Trailing non-numeric noise is preserved as `prerelease`.
 */
export function parseEngineVersion(input: string | null | undefined): ParsedVersion | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(VERSION_PATTERN)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: (match[4] ?? '').toLowerCase(),
  }
}

/**
 * Compare two parsed versions. Mirrors PEP 440-ish ordering for our use case:
 *   - any pre-release component is *older* than the corresponding final
 *     release (e.g. "0.2.0rc4" < "0.2.0").
 *   - between two pre-releases of the same major/minor/patch, lexical order
 *     decides ("rc3" < "rc4", "alpha" < "beta" < "rc").
 *
 * Returns < 0 if `a` precedes `b`, > 0 if `a` follows `b`, 0 if equal.
 */
export function compareEngineVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  // Same numeric core. A pre-release tag means "before the final release".
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease && b.prerelease) return 1
  if (a.prerelease && !b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease)
}

/**
 * Decide whether the engine currently answering the gateway port is too old
 * to host the UI. We never speculatively replace a *newer* engine: that path
 * is reserved for engineers running a custom mira-engine via MIRA_ENGINE_PATH
 * or a pre-release dev build.
 *
 * Stale conditions:
 *   - bundled version unknown → never stale (we have nothing better to swap in)
 *   - running version unknown → stale (almost certainly an older build that
 *     predates /version reporting)
 *   - both parse and running < bundled → stale
 *   - either fails to parse → fall back to strict-equality: any mismatch is
 *     treated as stale, so the bundle wins on ambiguous inputs.
 */
export function isRunningEngineStale(
  runningVersion: string | null | undefined,
  bundledVersion: string | null | undefined,
): boolean {
  if (!bundledVersion || !bundledVersion.trim()) return false
  if (runningVersion === undefined || runningVersion === null || !runningVersion.trim()) {
    return true
  }

  if (runningVersion.trim() === bundledVersion.trim()) return false

  const running = parseEngineVersion(runningVersion)
  const bundled = parseEngineVersion(bundledVersion)
  if (!running || !bundled) {
    // Unknown shape on either side: treat any mismatch as stale so the
    // bundled binary takes precedence. The dev override (MIRA_ENGINE_PATH)
    // is meant to be the explicit escape hatch for hand-rolled builds.
    return true
  }

  return compareEngineVersions(running, bundled) < 0
}
