import { spawn } from 'child_process'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { app } from 'electron'
import path from 'path'

export type LocalEnginePhase = 'idle' | 'checking' | 'installing' | 'repairing' | 'starting' | 'ready' | 'error'

export interface EngineCommandResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  command: string[]
  executablePath: string | null
}

export interface EngineBootstrapState {
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

type EngineStatusPayload = {
  installed?: boolean
  running?: boolean
  port?: number
  log_file?: string
  service_mode?: string
  windows_service?: string
  windows_service_status?: string
}

const DEFAULT_PORT = 18790
const DEFAULT_HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 45_000
const HEALTH_FAST_PATH_TIMEOUT_MS = 350
const HEALTH_POLL_FAST_INTERVAL_MS = 250
const HEALTH_POLL_SLOW_INTERVAL_MS = 1_000
const HEALTH_POLL_FAST_WINDOW_MS = 5_000
const COMMAND_TIMEOUT_MS = 120_000
const REPAIR_TIMEOUT_MS = 180_000
const BUNDLE_SETUP_PROVIDER = 'custom'
const BUNDLE_SETUP_MODEL = 'custom/mira-ui-bundle-setup'
const BUNDLE_SETUP_API_BASE = 'http://127.0.0.1:9/v1'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ensureRecord(parent: JsonRecord, key: string): JsonRecord {
  const current = parent[key]
  if (isRecord(current)) {
    return current
  }
  const next: JsonRecord = {}
  parent[key] = next
  return next
}

function engineExecutableName(): string {
  return process.platform === 'win32' ? 'mira-engine.exe' : 'mira-engine'
}

function bundledEngineCandidate(): string {
  const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const baseDir = app.isPackaged
    ? process.resourcesPath
    : path.resolve(app.getAppPath(), '..')
  return path.join(baseDir, 'bundled-engine', platformDir, engineExecutableName())
}

async function isExecutable(candidate: string): Promise<boolean> {
  if (!candidate) return false
  try {
    await access(candidate, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveExecutable(): Promise<string | null> {
  const fromEnv = process.env.MIRA_ENGINE_PATH?.trim()
  if (fromEnv && await isExecutable(fromEnv)) {
    return fromEnv
  }

  const bundled = bundledEngineCandidate()
  if (await isExecutable(bundled)) {
    return bundled
  }

  return null
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function defaultState(): EngineBootstrapState {
  return {
    phase: 'idle',
    message: 'Local engine bootstrap is idle.',
    executablePath: null,
    healthUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`,
    version: null,
    serviceInstalled: null,
    serviceRunning: null,
    lastCommand: null,
    error: null,
  }
}

export class LocalEngineManager {
  private state: EngineBootstrapState = defaultState()
  private bootstrapPromise: Promise<EngineBootstrapState> | null = null

  getState(): EngineBootstrapState {
    return { ...this.state, lastCommand: this.state.lastCommand ? [...this.state.lastCommand] : null }
  }

  private setState(patch: Partial<EngineBootstrapState>): EngineBootstrapState {
    this.state = { ...this.state, ...patch }
    return this.getState()
  }

  private configPath(): string {
    const fromEnv = process.env.MIRA_CONFIG_PATH?.trim()
    if (fromEnv) return fromEnv
    return path.join(app.getPath('home'), '.mira', 'config.json')
  }

  private defaultWorkspacePath(): string {
    return path.join(app.getPath('home'), '.mira', 'workspace')
  }

  private defaultLogPath(): string {
    return path.join(app.getPath('home'), '.mira', 'logs', 'agent-service.log')
  }

  private async ensureBundleRuntimeConfig(): Promise<{ ok: true; configPath: string } | { ok: false; message: string; error: string }> {
    const configPath = this.configPath()

    let root: JsonRecord = {}
    try {
      const raw = await readFile(configPath, 'utf8')
      if (raw.trim()) {
        const parsed = JSON.parse(raw)
        if (!isRecord(parsed)) {
          return {
            ok: false,
            message: `Existing Mira config is not a JSON object: ${configPath}`,
            error: 'config.json must contain a JSON object',
          }
        }
        root = parsed
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        return {
          ok: false,
          message: `Failed to read local engine config at ${configPath}.`,
          error: nodeError.message,
        }
      }
    }

    const agents = ensureRecord(root, 'agents')
    const defaults = ensureRecord(agents, 'defaults')
    const providers = ensureRecord(root, 'providers')
    const customProvider = ensureRecord(providers, BUNDLE_SETUP_PROVIDER)
    const channels = ensureRecord(root, 'channels')

    let changed = false

    // The engine renamed the "web" channel to "ui" in v0.4. If the user's
    // existing config still carries the legacy "channels.web" block we promote
    // it to "channels.ui" (and drop the legacy key) so both halves of the app
    // converge on the new name without losing any user-supplied settings.
    if (isRecord(channels.web)) {
      const legacyWeb = channels.web
      const existingUi = isRecord(channels.ui) ? channels.ui : {}
      const merged: JsonRecord = { ...legacyWeb, ...existingUi }
      channels.ui = merged
      delete channels.web
      changed = true
    }

    const uiChannel = ensureRecord(channels, 'ui')

    const setIfMissing = (target: JsonRecord, key: string, value: unknown) => {
      const current = target[key]
      const isMissing = current === undefined || current === null || (typeof current === 'string' && current.trim().length === 0)
      if (!isMissing) return
      target[key] = value
      changed = true
    }

    setIfMissing(defaults, 'workspace', this.defaultWorkspacePath())
    setIfMissing(defaults, 'provider', BUNDLE_SETUP_PROVIDER)
    setIfMissing(defaults, 'model', BUNDLE_SETUP_MODEL)
    setIfMissing(customProvider, 'apiBase', BUNDLE_SETUP_API_BASE)

    if (uiChannel.enabled !== true) {
      uiChannel.enabled = true
      changed = true
    }
    if (!Array.isArray(uiChannel.allowFrom) || uiChannel.allowFrom.length === 0) {
      uiChannel.allowFrom = ['*']
      changed = true
    }
    if (!Array.isArray(uiChannel.corsOrigins) || uiChannel.corsOrigins.length === 0) {
      uiChannel.corsOrigins = ['*']
      changed = true
    }

    if (!changed) {
      return { ok: true, configPath }
    }

    try {
      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
      return { ok: true, configPath }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      return {
        ok: false,
        message: `Failed to write local engine config at ${configPath}.`,
        error: nodeError.message,
      }
    }
  }

  private async readLogTail(logPath?: string | null, maxLines = 60): Promise<string> {
    const target = logPath?.trim() || this.defaultLogPath()
    try {
      const raw = await readFile(target, 'utf8')
      return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines).join('\n')
    } catch {
      return ''
    }
  }

  private diagnoseBootstrapFailure(logTail: string, port: number): { message: string; error: string } {
    if (logTail.includes("No such command 'run-gateway'")) {
      return {
        message: 'Bundled local engine is too old for bundle mode. Rebuild the bundle with a newer mira-engine asset.',
        error: logTail,
      }
    }

    const missingProvider = logTail.match(/Unable to match provider for model '([^']+)'/)
    if (missingProvider) {
      const model = missingProvider[1]
      return {
        message: `Local engine needs an LLM provider for model "${model}". Open Settings > Local Runtime Config and choose a provider before retrying.`,
        error: logTail,
      }
    }

    const missingApiKey = logTail.match(/No API key configured for model '([^']+)'/)
    if (missingApiKey) {
      const model = missingApiKey[1]
      return {
        message: `Local engine is running with model "${model}", but its provider API key is missing. Open Settings > Local Runtime Config and add the credential.`,
        error: logTail,
      }
    }

    if (logTail.includes('No model configured. Set agents.defaults.model in config.json.')) {
      return {
        message: 'Local engine config is missing a default model. Open Settings > Local Runtime Config and choose a model.',
        error: logTail,
      }
    }

    if (logTail.includes("Custom provider requires 'providers.custom.apiBase'")) {
      return {
        message: 'Local engine is using the custom provider, but API Base is empty. Open Settings > Local Runtime Config and set API Base.',
        error: logTail,
      }
    }

    if (logTail.includes('Failed to load config')) {
      return {
        message: 'Local engine config could not be parsed. Fix ~/.mira/config.json or refresh it from bundle settings.',
        error: logTail,
      }
    }

    return {
      message: `Timed out waiting for local engine health on http://${DEFAULT_HOST}:${port}/health.`,
      error: logTail || `Timed out waiting for local engine health on http://${DEFAULT_HOST}:${port}/health.`,
    }
  }

  async runCommand(args: string[], options?: { timeoutMs?: number }): Promise<EngineCommandResult> {
    const resolvedExecutable = await resolveExecutable()
    const executablePath = resolvedExecutable ?? engineExecutableName()
    const command = [executablePath, ...args]

    this.setState({
      executablePath: resolvedExecutable,
      lastCommand: command,
    })

    return new Promise((resolve) => {
      const child = spawn(executablePath, args, {
        shell: process.platform === 'win32' && executablePath === engineExecutableName(),
        env: process.env,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
      }, options?.timeoutMs ?? COMMAND_TIMEOUT_MS)

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          ok: false,
          code: 1,
          stdout: stdout.trim(),
          stderr: `${stderr}\n${err.message}`.trim(),
          command,
          executablePath: resolvedExecutable,
        })
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolve({
          ok: code === 0,
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command,
          executablePath: resolvedExecutable,
        })
      })
    })
  }

  async runCommandElevated(args: string[], options?: { timeoutMs?: number }): Promise<EngineCommandResult> {
    if (process.platform !== 'win32') {
      return this.runCommand(args, options)
    }

    const resolvedExecutable = await resolveExecutable()
    const executablePath = resolvedExecutable ?? engineExecutableName()
    const command = [executablePath, ...args]

    this.setState({
      executablePath: resolvedExecutable,
      lastCommand: command,
    })

    const argumentList = args.map(psLiteral).join(', ')
    const script = [
      `$process = Start-Process -FilePath ${psLiteral(executablePath)}`,
      `-ArgumentList @(${argumentList})`,
      '-Verb RunAs -Wait -PassThru;',
      'exit $process.ExitCode',
    ].join(' ')

    return new Promise((resolve) => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ], {
        env: process.env,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
      }, options?.timeoutMs ?? REPAIR_TIMEOUT_MS)

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          ok: false,
          code: 1,
          stdout: stdout.trim(),
          stderr: `${stderr}\n${err.message}`.trim(),
          command,
          executablePath: resolvedExecutable,
        })
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolve({
          ok: code === 0,
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command,
          executablePath: resolvedExecutable,
        })
      })
    })
  }

  async status(): Promise<{ result: EngineCommandResult; payload: EngineStatusPayload | null }> {
    const result = await this.runCommand(['status'])
    if (!result.ok) {
      return { result, payload: null }
    }
    try {
      return { result, payload: JSON.parse(result.stdout) as EngineStatusPayload }
    } catch {
      return { result, payload: null }
    }
  }

  async doctor(): Promise<EngineCommandResult> {
    return this.runCommand(['doctor'])
  }

  async start(): Promise<EngineCommandResult> {
    return this.runCommand(['start'])
  }

  async stop(): Promise<EngineCommandResult> {
    return this.runCommand(['stop'])
  }

  private installServiceArgs(port = DEFAULT_PORT): string[] {
    return [
      'install-service',
      '--host',
      DEFAULT_HOST,
      '--port',
      String(port),
      '--home',
      app.getPath('home'),
      '--config',
      this.configPath(),
    ]
  }

  private commandWithHome(command: string): string[] {
    return [command, '--home', app.getPath('home')]
  }

  async installService(port = DEFAULT_PORT): Promise<EngineCommandResult> {
    return this.runCommand(this.installServiceArgs(port))
  }

  async upgrade(packageName = 'mira-engine'): Promise<EngineCommandResult> {
    return this.runCommand(['upgrade', '--package', packageName], { timeoutMs: 180_000 })
  }

  private async probeHealth(port = DEFAULT_PORT, timeoutMs = HEALTH_FAST_PATH_TIMEOUT_MS): Promise<{ ok: boolean; version: string | null }> {
    const base = `http://${DEFAULT_HOST}:${port}`
    const fetchWithTimeout = async (url: string) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
    }

    try {
      const healthResp = await fetchWithTimeout(`${base}/health`)
      if (!healthResp.ok) {
        return { ok: false, version: null }
      }

      try {
        const versionResp = await fetchWithTimeout(`${base}/version`)
        if (versionResp.ok) {
          const payload = await versionResp.json() as { agent_version?: string }
          return {
            ok: true,
            version: typeof payload.agent_version === 'string' ? payload.agent_version : null,
          }
        }
      } catch {
        // Ignore version probe failures when health already passed.
      }

      return { ok: true, version: null }
    } catch {
      return { ok: false, version: null }
    }
  }

  private async waitForHealth(port = DEFAULT_PORT, logPath?: string | null): Promise<{ ok: boolean; version: string | null; message: string; error?: string }> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
      const health = await this.probeHealth(port)
      if (health.ok) {
        return { ok: true, version: health.version, message: 'Local engine is ready.' }
      }

      const elapsed = Date.now() - startedAt
      const pollInterval = elapsed < HEALTH_POLL_FAST_WINDOW_MS
        ? HEALTH_POLL_FAST_INTERVAL_MS
        : HEALTH_POLL_SLOW_INTERVAL_MS
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
    return { ok: false, version: null, ...this.diagnoseBootstrapFailure(await this.readLogTail(logPath), port) }
  }

  async repairLocalEngineService(): Promise<EngineBootstrapState> {
    this.setState({
      phase: 'repairing',
      message: 'Repairing local engine service...',
      error: null,
    })

    const status = await this.status()
    const port = status.payload?.port ?? DEFAULT_PORT
    const healthUrl = `http://${DEFAULT_HOST}:${port}/health`

    const install = process.platform === 'win32'
      ? await this.runCommandElevated(this.installServiceArgs(port), { timeoutMs: REPAIR_TIMEOUT_MS })
      : await this.installService(port)
    if (!install.ok) {
      return this.setState({
        phase: 'error',
        message: install.stderr || install.stdout || 'Local engine service repair failed.',
        executablePath: install.executablePath,
        serviceInstalled: false,
        serviceRunning: false,
        healthUrl,
        error: install.stderr || install.stdout || 'install-service failed',
      })
    }

    const start = process.platform === 'win32'
      ? await this.runCommandElevated(this.commandWithHome('start'), { timeoutMs: REPAIR_TIMEOUT_MS })
      : await this.start()
    if (!start.ok) {
      return this.setState({
        phase: 'error',
        message: start.stderr || start.stdout || 'Local engine service repaired but failed to start.',
        executablePath: start.executablePath,
        serviceInstalled: true,
        serviceRunning: false,
        healthUrl,
        error: start.stderr || start.stdout || 'start failed',
      })
    }

    this.setState({
      phase: 'starting',
      message: 'Waiting for repaired local engine health check...',
      executablePath: install.executablePath,
      serviceInstalled: true,
      serviceRunning: true,
      healthUrl,
    })

    const health = await this.waitForHealth(port, status.payload?.log_file)
    if (!health.ok) {
      return this.setState({
        phase: 'error',
        message: health.message,
        serviceInstalled: true,
        serviceRunning: true,
        healthUrl,
        version: null,
        error: health.error ?? health.message,
      })
    }

    return this.setState({
      phase: 'ready',
      message: health.message,
      serviceInstalled: true,
      serviceRunning: true,
      version: health.version,
      healthUrl,
      error: null,
    })
  }

  async bootstrapLocalEngine(): Promise<EngineBootstrapState> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise
    }

    this.bootstrapPromise = (async () => {
      this.setState({
        phase: 'checking',
        message: 'Checking bundled local engine...',
        error: null,
      })

      const seeded = await this.ensureBundleRuntimeConfig()
      if (!seeded.ok) {
        return this.setState({
          phase: 'error',
          message: seeded.message,
          executablePath: this.state.executablePath,
          serviceInstalled: null,
          serviceRunning: null,
          error: seeded.error,
        })
      }

      const fastExecutablePath = await resolveExecutable()
      const fastHealth = await this.probeHealth(DEFAULT_PORT)
      if (fastHealth.ok) {
        return this.setState({
          phase: 'ready',
          message: 'Local engine is ready.',
          executablePath: fastExecutablePath,
          serviceInstalled: true,
          serviceRunning: true,
          healthUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`,
          version: fastHealth.version,
          error: null,
        })
      }

      const status = await this.status()
      if (!status.result.ok && !status.result.executablePath) {
        return this.setState({
          phase: 'error',
          message: 'Bundled local engine was not found. Install a bundle build or set MIRA_ENGINE_PATH.',
          executablePath: null,
          serviceInstalled: null,
          serviceRunning: null,
          error: status.result.stderr || 'mira-engine executable unavailable',
        })
      }

      let serviceInstalled = Boolean(status.payload?.installed)
      let serviceRunning = Boolean(status.payload?.running)
      const port = status.payload?.port ?? DEFAULT_PORT
      const healthUrl = `http://${DEFAULT_HOST}:${port}/health`

      if (port !== DEFAULT_PORT) {
        return this.setState({
          phase: 'error',
          message: `Bundled local engine reports legacy port ${port}, but MIRA expects ${DEFAULT_PORT}. Rebuild or upgrade the bundled engine asset.`,
          executablePath: status.result.executablePath,
          serviceInstalled,
          serviceRunning,
          healthUrl,
          error: `legacy bundled engine port ${port}`,
        })
      }

      this.setState({
        executablePath: status.result.executablePath,
        serviceInstalled,
        serviceRunning,
        healthUrl,
      })

      if (!serviceInstalled) {
        this.setState({
          phase: 'installing',
          message: 'Installing local engine service...',
          serviceInstalled: false,
          serviceRunning,
        })
        const install = await this.installService(port)
        if (!install.ok) {
          return this.setState({
            phase: 'error',
            message: install.stderr || 'Local engine service install failed.',
            executablePath: install.executablePath,
            serviceInstalled: false,
            serviceRunning,
            error: install.stderr || install.stdout || 'install-service failed',
          })
        }

        const refreshed = await this.status()
        serviceInstalled = Boolean(refreshed.payload?.installed)
        serviceRunning = Boolean(refreshed.payload?.running)
      }

      if (!serviceRunning) {
        this.setState({
          phase: 'starting',
          message: 'Starting local engine service...',
          serviceInstalled,
          serviceRunning: false,
        })
        const started = await this.start()
        if (!started.ok) {
          return this.setState({
            phase: 'error',
            message: started.stderr || 'Local engine service failed to start.',
            executablePath: started.executablePath,
            serviceInstalled,
            serviceRunning: false,
            error: started.stderr || started.stdout || 'start failed',
          })
        }
        serviceRunning = true
      }

      this.setState({
        phase: 'starting',
        message: 'Waiting for local engine health check...',
        serviceInstalled,
        serviceRunning,
        healthUrl,
      })

      const health = await this.waitForHealth(port, status.payload?.log_file)
      if (!health.ok) {
        return this.setState({
          phase: 'error',
          message: health.message,
          serviceInstalled,
          serviceRunning,
          healthUrl,
          version: null,
          error: health.error ?? health.message,
        })
      }

      return this.setState({
        phase: 'ready',
        message: health.message,
        serviceInstalled,
        serviceRunning,
        version: health.version,
        error: null,
      })
    })()

    try {
      return await this.bootstrapPromise
    } finally {
      this.bootstrapPromise = null
    }
  }
}
