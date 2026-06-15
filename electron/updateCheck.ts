import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { request } from 'node:https'

import { compareVersions, isPrerelease, parseVersion } from '../src/lib/version'
import { getSkippedVersions, setSkippedVersions } from './appState'

// GitHub repo to query for releases. Hard-coded since we own the repo and
// shipping a setting for "where to check for updates" would invite confusion.
const RELEASES_OWNER = 'MIRA-Intelligence'
const RELEASES_REPO = 'mira-ui'
const RELEASES_API = `https://api.github.com/repos/${RELEASES_OWNER}/${RELEASES_REPO}/releases?per_page=15`

// Soft cache so background re-checks (and a quick double-tap of "Check now")
// don't burn the unauthenticated 60-req/hour GitHub API budget.
const CACHE_TTL_MS = 60 * 60 * 1000

// Renderer-facing payload describing an actionable update offer.
export interface UpdateInfo {
  version: string        // normalized "0.4.0" or "0.4.0-rc.1"
  tagName: string        // raw GitHub tag e.g. "v0.4.0rc1"
  name: string           // GitHub release name
  url: string            // human-friendly release page
  publishedAt: string    // ISO timestamp
  isPrerelease: boolean
  notes: string          // release body markdown (truncated)
}

interface CacheEntry {
  checkedAt: number
  includePrereleases: boolean
  result: UpdateInfo | null
}

interface RawRelease {
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  published_at?: string
  body?: string
}

let cache: CacheEntry | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': `mira-ui/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject)
          return
        }
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new Error(`HTTP ${status} from ${url}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.from(c)))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Update check request timed out'))
    })
    req.end()
  })
}

function normalizeRelease(release: RawRelease): UpdateInfo | null {
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const parsed = parseVersion(tag)
  if (!parsed) return null
  const prerel = parsed.prerelease
  const normalized = prerel
    ? `${parsed.major}.${parsed.minor}.${parsed.patch}-${prerel.label}.${prerel.number}`
    : `${parsed.major}.${parsed.minor}.${parsed.patch}`
  const url =
    typeof release.html_url === 'string' && release.html_url
      ? release.html_url
      : `https://github.com/${RELEASES_OWNER}/${RELEASES_REPO}/releases/tag/${tag}`
  return {
    version: normalized,
    tagName: tag,
    name: typeof release.name === 'string' && release.name ? release.name : tag,
    url,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
    isPrerelease: !!release.prerelease || isPrerelease(tag),
    notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
  }
}

export async function checkForUpdates(opts: {
  includePrereleases?: boolean
  forceRefresh?: boolean
} = {}): Promise<UpdateInfo | null> {
  const includePrereleases = !!opts.includePrereleases
  const now = Date.now()
  if (
    !opts.forceRefresh &&
    cache &&
    cache.includePrereleases === includePrereleases &&
    now - cache.checkedAt < CACHE_TTL_MS
  ) {
    return cache.result
  }

  let payload: unknown
  try {
    payload = await fetchJson(RELEASES_API)
  } catch (err) {
    // Network failures are common (offline laptops, captive portals); never
    // throw to the renderer — just skip this check and try again later.
    console.warn('[update] fetch failed:', err instanceof Error ? err.message : err)
    cache = { checkedAt: now, includePrereleases, result: null }
    return null
  }

  if (!Array.isArray(payload)) {
    cache = { checkedAt: now, includePrereleases, result: null }
    return null
  }

  const candidates = (payload as RawRelease[])
    .filter((r) => r && !r.draft)
    .map(normalizeRelease)
    .filter((r): r is UpdateInfo => r !== null)
    .filter((r) => includePrereleases || !r.isPrerelease)

  if (candidates.length === 0) {
    cache = { checkedAt: now, includePrereleases, result: null }
    return null
  }

  // Pick the newest candidate by parsed version order, falling back to publish
  // date if two releases somehow parse to the same version.
  candidates.sort((a, b) => {
    const av = parseVersion(a.tagName)
    const bv = parseVersion(b.tagName)
    if (av && bv) {
      const cmp = compareVersions(av, bv)
      if (cmp !== 0) return -cmp
    }
    return (b.publishedAt || '').localeCompare(a.publishedAt || '')
  })

  const best = candidates[0]
  const current = parseVersion(app.getVersion())
  const bestParsed = parseVersion(best.tagName)
  if (!current || !bestParsed) {
    cache = { checkedAt: now, includePrereleases, result: null }
    return null
  }
  const isNewer = compareVersions(bestParsed, current) === 1
  const result = isNewer ? best : null
  cache = { checkedAt: now, includePrereleases, result }
  return result
}

async function notifyRendererIfActionable(info: UpdateInfo | null): Promise<void> {
  if (!info) return
  const skippedVersions = await getSkippedVersions()
  if (skippedVersions.includes(info.version)) return
  const win = getMainWindow?.()
  if (!win || win.isDestroyed()) return
  win.webContents.send('update:available', info)
}

export function registerUpdateCheck(getWindow: () => BrowserWindow | null): void {
  getMainWindow = getWindow

  ipcMain.handle(
    'update:check',
    async (_event, opts?: { includePrereleases?: boolean; forceRefresh?: boolean }) => {
      const info = await checkForUpdates({
        includePrereleases: !!opts?.includePrereleases,
        forceRefresh: !!opts?.forceRefresh,
      })
      // Notify too, so the banner appears even when the renderer asked via
      // an explicit "Check now" click (and not just via boot autocheck).
      await notifyRendererIfActionable(info)
      return info
    },
  )

  ipcMain.handle('update:get-app-version', () => app.getVersion())

  ipcMain.handle('update:open-release', async (_event, url: string) => {
    if (typeof url !== 'string') return false
    // Restrict to github.com to avoid being weaponized as an arbitrary URL
    // launcher via a compromised renderer.
    try {
      const u = new URL(url)
      if (u.hostname !== 'github.com' && !u.hostname.endsWith('.github.com')) return false
    } catch {
      return false
    }
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('update:skip-version', async (_event, version: string) => {
    if (typeof version !== 'string' || !version) return false
    const skippedVersions = await getSkippedVersions()
    if (!skippedVersions.includes(version)) {
      await setSkippedVersions([...skippedVersions, version])
    }
    return true
  })

  ipcMain.handle('update:get-skipped-versions', async () => {
    return getSkippedVersions()
  })

  ipcMain.handle('update:reset-skipped-versions', async () => {
    await setSkippedVersions([])
    return true
  })
}

// Schedule the boot-time check. Wait long enough that we don't compete with
// the local-engine bootstrap for renderer attention.
export function scheduleBootCheck(opts: { includePrereleases: boolean }): void {
  setTimeout(() => {
    void checkForUpdates({ includePrereleases: opts.includePrereleases })
      .then(notifyRendererIfActionable)
      .catch((err) => {
        console.warn('[update] boot check failed:', err instanceof Error ? err.message : err)
      })
  }, 5_000)
}
