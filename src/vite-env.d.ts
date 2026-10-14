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
    recordDiagnostic?: (record: import('./lib/diagnosticPrivacy').DiagnosticEvent) => void
    exportDiagnostics?: (options?: { includeLocalEngine?: boolean }) => Promise<string | null>
    bootstrapLocalEngine?: (options?: { force?: boolean }) => Promise<{
      phase: 'idle' | 'checking' | 'installing' | 'updating' | 'repairing' | 'starting' | 'ready' | 'error'
      message: string
      executablePath: string | null
      healthUrl: string
      version: string | null
      operation: 'bootstrap' | 'install' | 'update' | 'repair' | 'start' | null
      serviceInstalled: boolean | null
      serviceRunning: boolean | null
      lastCommand: string[] | null
      error: string | null
    }>
    setEngineModeHint?: (mode: 'localBundle' | 'remoteManual' | 'remoteSsh' | 'teamServer') => Promise<boolean>
    getEngineToken?: () => Promise<string | null>
    remoteSshConnect?: (host: string, miraCommand?: string) => Promise<import('./services/remoteSsh').RemoteSshStatus>
    remoteSshDisconnect?: () => Promise<import('./services/remoteSsh').RemoteSshStatus>
    remoteSshStatus?: () => Promise<import('./services/remoteSsh').RemoteSshStatus>
    getRemoteSshToken?: () => Promise<string | null>
    listSshHosts?: () => Promise<string[]>
    onRemoteSshStatus?: (listener: (status: unknown) => void) => () => void
    onRemoteSshPrompt?: (listener: (prompt: unknown) => void) => () => void
    onRemoteSshPromptCancel?: (listener: (payload: unknown) => void) => () => void
    answerRemoteSshPrompt?: (id: string, answer: string | null) => Promise<boolean>
    getRemoteInstallPlan?: () => Promise<unknown>
    installRemoteMira?: () => Promise<unknown>
    cancelRemoteInstall?: () => Promise<boolean>
    onRemoteInstallOutput?: (listener: (chunk: unknown) => void) => () => void
    teamServerInfo?: (origin: string) => Promise<unknown>
    teamServerLogin?: (origin: string, username: string, password: string) => Promise<unknown>
    teamServerSession?: (origin: string) => Promise<unknown>
    teamServerRefresh?: (origin: string, rejectedToken?: string | null) => Promise<unknown>
    teamServerLogout?: (origin: string) => Promise<boolean>
    onTeamServerSession?: (listener: (event: unknown) => void) => () => void
    getBootstrapState?: () => Promise<{
      phase: 'idle' | 'checking' | 'installing' | 'updating' | 'repairing' | 'starting' | 'ready' | 'error'
      message: string
      executablePath: string | null
      healthUrl: string
      version: string | null
      operation: 'bootstrap' | 'install' | 'update' | 'repair' | 'start' | null
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
        engine_executable?: string | null
        engine_manifest?: { sha256?: string } | null
        engine_sha256?: string | null
        launchd_program?: string | null
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
    repairLocalEngineService?: () => Promise<{
      phase: 'idle' | 'checking' | 'installing' | 'updating' | 'repairing' | 'starting' | 'ready' | 'error'
      message: string
      executablePath: string | null
      healthUrl: string
      version: string | null
      operation: 'bootstrap' | 'install' | 'update' | 'repair' | 'start' | null
      serviceInstalled: boolean | null
      serviceRunning: boolean | null
      lastCommand: string[] | null
      error: string | null
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
    restartLocalEngine?: () => Promise<import('./services/desktop').LocalEngineCommandResult>
    doctorLocalEngine?: () => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    selectDataPath?: (kind: 'file' | 'directory') => Promise<string | null>
    selectDirectory?: () => Promise<string | null>
    upgradeLocalEngine?: (packageName?: string) => Promise<{
      ok: boolean
      code: number
      stdout: string
      stderr: string
      command: string[]
      executablePath: string | null
    }>
    getAppVersion?: () => Promise<string>
    checkForUpdates?: (opts?: {
      includePrereleases?: boolean
      forceRefresh?: boolean
    }) => Promise<UpdateInfo | null>
    openReleasePage?: (url: string) => Promise<boolean>
    skipUpdateVersion?: (version: string) => Promise<boolean>
    getSkippedUpdateVersions?: () => Promise<string[]>
    resetSkippedUpdateVersions?: () => Promise<boolean>
    onUpdateAvailable?: (listener: (info: UpdateInfo) => void) => () => void
  }
}

interface UpdateInfo {
  version: string
  tagName: string
  name: string
  url: string
  publishedAt: string
  isPrerelease: boolean
  notes: string
}

declare const __APP_VERSION__: string
