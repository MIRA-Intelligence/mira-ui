export type LocalEnginePhase = 'idle' | 'checking' | 'installing' | 'starting' | 'ready' | 'error'

export interface LocalEngineCommandResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  command: string[]
  executablePath: string | null
}

export interface LocalEngineStatusResult {
  result: LocalEngineCommandResult
  payload: {
    installed?: boolean
    running?: boolean
    port?: number
  } | null
}

export interface LocalEngineBootstrapState {
  phase: LocalEnginePhase
  message: string
  executablePath: string | null
  healthUrl: string
  version: string | null
  serviceInstalled: boolean | null
  serviceRunning: boolean | null
  lastCommand: string[] | null
  error: string | null
}

function getElectronApi() {
  return window.electronAPI
}

export function hasDesktopEngineManager(): boolean {
  return typeof window !== 'undefined' && Boolean(getElectronApi()?.bootstrapLocalEngine)
}

export async function bootstrapLocalEngine(): Promise<LocalEngineBootstrapState | null> {
  return getElectronApi()?.bootstrapLocalEngine?.() ?? null
}

export async function getBootstrapState(): Promise<LocalEngineBootstrapState | null> {
  return getElectronApi()?.getBootstrapState?.() ?? null
}

export async function getLocalEngineStatus(): Promise<LocalEngineStatusResult | null> {
  return getElectronApi()?.getLocalEngineStatus?.() ?? null
}

export async function installLocalEngineService(): Promise<LocalEngineCommandResult | null> {
  return getElectronApi()?.installLocalEngineService?.() ?? null
}

export async function startLocalEngine(): Promise<LocalEngineCommandResult | null> {
  return getElectronApi()?.startLocalEngine?.() ?? null
}

export async function stopLocalEngine(): Promise<LocalEngineCommandResult | null> {
  return getElectronApi()?.stopLocalEngine?.() ?? null
}

export async function doctorLocalEngine(): Promise<LocalEngineCommandResult | null> {
  return getElectronApi()?.doctorLocalEngine?.() ?? null
}

export async function upgradeLocalEngine(packageName = 'mira-engine'): Promise<LocalEngineCommandResult | null> {
  return getElectronApi()?.upgradeLocalEngine?.(packageName) ?? null
}
