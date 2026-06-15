import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Single main-process state file under userData. Holds small, app-level bits
// that the main process needs before (or independently of) the renderer's
// localStorage is available — e.g. the update skip-list and a hint for which
// engine deployment mode the user last used, so the boot-time local-engine
// pre-warm can be skipped in remote mode.
export type DeploymentModeHint = 'localBundle' | 'remoteManual'

export interface AppState {
  skippedVersions: string[]
  lastDeploymentMode: DeploymentModeHint | null
}

const STATE_FILENAME = 'app-state.json'
// Pre-generalization the file only stored the update skip-list under this name.
const LEGACY_STATE_FILENAME = 'update-state.json'

function emptyState(): AppState {
  return { skippedVersions: [], lastDeploymentMode: null }
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
  const lastDeploymentMode =
    obj.lastDeploymentMode === 'localBundle' || obj.lastDeploymentMode === 'remoteManual'
      ? obj.lastDeploymentMode
      : null
  return { skippedVersions, lastDeploymentMode }
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
