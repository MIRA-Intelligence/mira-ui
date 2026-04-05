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
    upgradeLocalEngine?: (packageName?: string) => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
    }>
  }
}
