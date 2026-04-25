/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL: string
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  electronAPI?: {
    platform: string
    bootstrapLocalEngine?: () => Promise<{
      phase: 'idle' | 'checking' | 'installing' | 'starting' | 'ready' | 'error'
      message: string
      executablePath: string | null
      healthUrl: string
      version: string | null
      serviceInstalled: boolean | null
      serviceRunning: boolean | null
      lastCommand: string[] | null
      error: string | null
    }>
    getBootstrapState?: () => Promise<{
      phase: 'idle' | 'checking' | 'installing' | 'starting' | 'ready' | 'error'
      message: string
      executablePath: string | null
      healthUrl: string
      version: string | null
      serviceInstalled: boolean | null
      serviceRunning: boolean | null
      lastCommand: string[] | null
      error: string | null
    }>
    getLocalEngineStatus?: () => Promise<{
      result: {
        ok: boolean
        code: number
        stdout: string
        stderr: string
        command: string[]
        executablePath: string | null
      }
      payload: {
        installed?: boolean
        running?: boolean
        port?: number
      } | null
    }>
    installLocalEngineService?: () => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    startLocalEngine?: () => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    stopLocalEngine?: () => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    doctorLocalEngine?: () => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    upgradeLocalEngine?: (packageName?: string) => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
  }
}
