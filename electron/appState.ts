import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isRememberablePath } from './remoteSsh'

// Single main-process state file under userData. Holds small, app-level bits
// that the main process needs before (or independently of) the renderer's
// localStorage is available — e.g. the update skip-list and a hint for which
// engine deployment mode the user last used, so the boot-time local-engine
// pre-warm can be skipped in remote mode.
export type DeploymentModeHint = 'localBundle' | 'remoteManual' | 'remoteSsh' | 'teamServer'

export function isDeploymentModeHint(value: unknown): value is DeploymentModeHint {
  return value === 'localBundle' || value === 'remoteManual' || value === 'remoteSsh' || value === 'teamServer'
}

export interface AppState {
  skippedVersions: string[]
  lastDeploymentMode: DeploymentModeHint | null
  // Remote-SSH: the remote mira path that last worked, per SSH host. A path,
  // not a credential.
  sshMiraPaths: Record<string, string>
}

const MAX_SSH_MIRA_PATHS = 100

const STATE_FILENAME = 'app-state.json'
// Pre-generalization the file only stored the update skip-list under this name.
const LEGACY_STATE_FILENAME = 'update-state.json'

function emptyState(): AppState {
  return { skippedVersions: [], lastDeploymentMode: null, sshMiraPaths: {} }
}

function stateFile(): string {
  return join(app.getPath('userData'), STATE_FILENAME)
}

function legacyStateFile(): string {
  return join(app.getPath('userData'), LEGACY_STATE_FILENAME)
}

function sanitize(parsed: unknown): AppState {
  if (!parsed || typeof parsed !== 'object') return emptyState()
  const obj = parsed as Record<string, unknown>
  const skippedVersions = Array.isArray(obj.skippedVersions)
    ? obj.skippedVersions.filter((v): v is string => typeof v === 'string')
    : []
  const lastDeploymentMode = isDeploymentModeHint(obj.lastDeploymentMode) ? obj.lastDeploymentMode : null
  const sshMiraPaths: Record<string, string> = {}
  if (obj.sshMiraPaths && typeof obj.sshMiraPaths === 'object' && !Array.isArray(obj.sshMiraPaths)) {
    for (const [host, value] of Object.entries(obj.sshMiraPaths as Record<string, unknown>)) {
      if (host && host.length <= 255 && isRememberablePath(value)) sshMiraPaths[host] = value
    }
  }
  return { skippedVersions, lastDeploymentMode, sshMiraPaths }
}

async function readFromFile(file: string): Promise<AppState | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return sanitize(JSON.parse(raw))
  } catch {
    return null
  }
}

async function writeAppState(state: AppState): Promise<void> {
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    /* best-effort — persisted app state is non-critical */
  }
}

export async function readAppState(): Promise<AppState> {
  const current = await readFromFile(stateFile())
  if (current) return current

  // One-time migration from the legacy update-only state file. Best-effort:
  // if the read/write fails we just start fresh (the skip-list is non-critical
  // and regenerates from user action).
  const legacy = await readFromFile(legacyStateFile())
  if (legacy) {
    await writeAppState(legacy)
    return legacy
  }

  return emptyState()
}

export async function getSkippedVersions(): Promise<string[]> {
  return (await readAppState()).skippedVersions
}

export async function setSkippedVersions(versions: string[]): Promise<void> {
  const state = await readAppState()
  state.skippedVersions = versions.filter((v) => typeof v === 'string')
  await writeAppState(state)
}

export async function getLastDeploymentMode(): Promise<DeploymentModeHint | null> {
  return (await readAppState()).lastDeploymentMode
}

export async function setLastDeploymentMode(mode: DeploymentModeHint): Promise<void> {
  const state = await readAppState()
  state.lastDeploymentMode = mode
  await writeAppState(state)
}

export async function getSshMiraPath(host: string): Promise<string | null> {
  return (await readAppState()).sshMiraPaths[host] ?? null
}

export async function setSshMiraPath(host: string, path: string): Promise<void> {
  if (!host || host.length > 255 || !isRememberablePath(path)) return
  const state = await readAppState()
  // Most recent last; the oldest hosts are forgotten past the cap.
  delete state.sshMiraPaths[host]
  state.sshMiraPaths[host] = path
  const hosts = Object.keys(state.sshMiraPaths)
  for (const stale of hosts.slice(0, Math.max(0, hosts.length - MAX_SSH_MIRA_PATHS))) delete state.sshMiraPaths[stale]
  await writeAppState(state)
}
