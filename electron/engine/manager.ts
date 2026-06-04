import { execFile, spawn } from 'child_process'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { app } from 'electron'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type LocalEnginePhase = 'idle' | 'checking' | 'installing' | 'updating' | 'repairing' | 'starting' | 'ready' | 'error'
export type LocalEngineOperation = 'bootstrap' | 'install' | 'update' | 'repair' | 'start' | null

type EngineManifest = {
  schema?: number
  kind?: string
  sha256?: string
  uiBundleVersion?: string | null
  engineReleaseTag?: string | null
  generatedAt?: string
  platform?: string
  arch?: string
  executable?: string
  size?: number
  feedbackConfigSha256?: string | null
}

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
  operation: LocalEngineOperation
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
  engine_executable?: string | null
  engine_manifest_path?: string | null
  engine_manifest?: EngineManifest | null
  engine_sha256?: string | null
  launchd_program?: string | null
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
const INSTALL_RETRY_DELAY_MS = 3_000
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

function engineManifestCandidate(executablePath: string): string {
  return path.join(path.dirname(executablePath), 'mira-engine.manifest.json')
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

async function readEngineManifest(executablePath: string | null): Promise<EngineManifest | null> {
  if (!executablePath) return null
  try {
    const raw = await readFile(engineManifestCandidate(executablePath), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as EngineManifest
  } catch {
    return null
  }
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
    operation: null,
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

  private async probePortHolder(port: number): Promise<{ pid: number; command: string } | null> {
    // Best-effort identification of whichever process is squatting on the
    // engine port when health checks fail. Treat any error as "unknown" so
    // diagnostics never block the failure path.
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], { timeout: 3000 })
        const line = stdout
          .split(/\r?\n/)
          .map((row) => row.trim())
          .find((row) => /\sLISTENING\s/i.test(row) && row.includes(`:${port}`))
        if (!line) return null
        const parts = line.split(/\s+/)
        const pidRaw = parts[parts.length - 1]
        const pid = Number.parseInt(pidRaw, 10)
        if (!Number.isFinite(pid) || pid <= 0) return null
        let command = `pid ${pid}`
        try {
          const { stdout: tasklist } = await execFileAsync(
            'tasklist',
            ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
            { timeout: 3000 },
          )
          const firstLine = tasklist.split(/\r?\n/).find((row) => row.trim().length > 0)
          if (firstLine) {
            const match = firstLine.match(/"([^"]+)"/)
            if (match) command = match[1]
          }
        } catch {
          // Fall back to pid-only label.
        }
        return { pid, command }
      }
      // macOS / Linux: lsof is available out of the box on macOS and on
      // most modern Linux distros. Use a short timeout so we never block
      // the bootstrap UX more than a second.
      const { stdout } = await execFileAsync(
        'lsof',
        ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'],
        { timeout: 1500 },
      )
      let pid = 0
      let command = ''
      for (const row of stdout.split(/\r?\n/)) {
        if (row.startsWith('p')) pid = Number.parseInt(row.slice(1), 10)
        else if (row.startsWith('c')) command = row.slice(1)
      }
      if (!Number.isFinite(pid) || pid <= 0) return null
      return { pid, command: command || `pid ${pid}` }
    } catch {
      return null
    }
  }

  private diagnoseBootstrapFailure(
    logTail: string,
    port: number,
    portHolder: { pid: number; command: string } | null = null,
  ): { message: string; error: string } {
    if (portHolder) {
      const detail = `${portHolder.command} (pid ${portHolder.pid})`
      return {
        message: `Local engine port ${port} is already in use by ${detail}. Quit that process or change the engine port, then retry.`,
        error: logTail || `port ${port} held by ${detail}`,
      }
    }

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

    if (logTail.includes('Mira workspace is not accessible')) {
      return {
        message: 'Local engine workspace is not accessible. Open Settings > Workspace and choose a valid path, or edit agents.defaults.workspace in ~/.mira/config.json.',
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
    if (process.platform === 'win32') {
      return this.runCommandElevated(this.commandWithHome('start'), { timeoutMs: REPAIR_TIMEOUT_MS })
    }
    return this.runCommand(['start'])
  }

  async stop(): Promise<EngineCommandResult> {
    if (process.platform === 'win32') {
      return this.runCommandElevated(this.commandWithHome('stop'), { timeoutMs: REPAIR_TIMEOUT_MS })
    }
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
    if (process.platform === 'win32') {
      return this.runCommandElevated(this.installServiceArgs(port), { timeoutMs: REPAIR_TIMEOUT_MS })
    }
    return this.runCommand(this.installServiceArgs(port))
  }

  async upgrade(packageName = 'mira-engine'): Promise<EngineCommandResult> {
    return this.runCommand(['upgrade', '--package', packageName], { timeoutMs: 180_000 })
  }

  private async probeHealth(port = DEFAULT_PORT, timeoutMs = HEALTH_FAST_PATH_TIMEOUT_MS): Promise<{
    ok: boolean
    version: string | null
    engineSha256: string | null
    engineShaAtBoot: string | null
    engineExecutable: string | null
    feedbackConfigSha256: string | null
  }> {
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
        return { ok: false, version: null, engineSha256: null, engineShaAtBoot: null, engineExecutable: null, feedbackConfigSha256: null }
      }

      try {
        const versionResp = await fetchWithTimeout(`${base}/version`)
        if (versionResp.ok) {
          const payload = await versionResp.json() as {
            agent_version?: string
            engine_sha256?: string | null
            engine_sha256_at_boot?: string | null
            engine_executable?: string | null
            feedback_config_sha256?: string | null
          }
          return {
            ok: true,
            version: typeof payload.agent_version === 'string' ? payload.agent_version : null,
            engineSha256: typeof payload.engine_sha256 === 'string' ? payload.engine_sha256 : null,
            engineShaAtBoot: typeof payload.engine_sha256_at_boot === 'string' ? payload.engine_sha256_at_boot : null,
            engineExecutable: typeof payload.engine_executable === 'string' ? payload.engine_executable : null,
            feedbackConfigSha256: typeof payload.feedback_config_sha256 === 'string' ? payload.feedback_config_sha256 : null,
          }
        }
      } catch {
        // Ignore version probe failures when health already passed.
      }

      return { ok: true, version: null, engineSha256: null, engineShaAtBoot: null, engineExecutable: null, feedbackConfigSha256: null }
    } catch {
      return { ok: false, version: null, engineSha256: null, engineShaAtBoot: null, engineExecutable: null, feedbackConfigSha256: null }
    }
  }

  private liveEngineMatchesBundle(
    probe: { engineSha256: string | null; engineShaAtBoot: string | null; engineExecutable: string | null; feedbackConfigSha256: string | null },
    bundledExecutablePath: string | null,
    bundledManifest: EngineManifest | null,
  ): boolean {
    const expectedSha = typeof bundledManifest?.sha256 === 'string' ? bundledManifest.sha256 : null
    const expectedFeedbackSha = typeof bundledManifest?.feedbackConfigSha256 === 'string'
      ? bundledManifest.feedbackConfigSha256
      : null

    // Dev / test build with no bundled manifest — accept the live engine.
    if (!expectedSha) return true

    // Authoritative path: only engines that snapshot their identity at
    // startup expose engine_sha256_at_boot. ``engine_sha256`` on its own is
    // unreliable because a DMG re-install overwrites the manifest file in
    // place, and the old running engine will re-read it on the next
    // /version call and falsely report the new SHA. Forcing the absence
    // of this marker to "mismatch" causes a one-time reinstall that swaps
    // the old engine for one that *does* snapshot at boot.
    if (probe.engineShaAtBoot != null) {
      if (probe.engineShaAtBoot !== expectedSha) return false
      return expectedFeedbackSha == null || probe.feedbackConfigSha256 === expectedFeedbackSha
    }

    // Engine pre-dates the boot-snapshot fix — its identity reporting
    // cannot be trusted. Force the reinstall path.
    return false
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
    const [logTail, portHolder] = await Promise.all([
      this.readLogTail(logPath),
      this.probePortHolder(port),
    ])
    return { ok: false, version: null, ...this.diagnoseBootstrapFailure(logTail, port, portHolder) }
  }

  private serviceMatchesBundledEngine(
    payload: EngineStatusPayload | null,
    executablePath: string | null,
    manifest: EngineManifest | null,
  ): boolean {
    if (!payload?.installed) return true

    const expectedSha = typeof manifest?.sha256 === 'string' ? manifest.sha256 : null
    const installedSha = typeof payload.engine_manifest?.sha256 === 'string'
      ? payload.engine_manifest.sha256
      : payload.engine_sha256 ?? null
    if (expectedSha) {
      if (installedSha !== expectedSha) return false
      const expectedFeedbackSha = typeof manifest?.feedbackConfigSha256 === 'string'
        ? manifest.feedbackConfigSha256
        : null
      const installedFeedbackSha = typeof payload.engine_manifest?.feedbackConfigSha256 === 'string'
        ? payload.engine_manifest.feedbackConfigSha256
        : null
      if (expectedFeedbackSha && installedFeedbackSha !== expectedFeedbackSha) return false
      return true
    }

    if (!executablePath) return true
    const installedPath = payload.engine_executable ?? payload.launchd_program ?? null
    if (!installedPath) return false
    return path.normalize(installedPath) === path.normalize(executablePath)
  }

  private requiresWindowsServiceInstall(payload: EngineStatusPayload | null): boolean {
    return process.platform === 'win32' && payload?.service_mode !== 'windows-service'
  }

  private async runInstallServiceWithRetry(
    port: number,
  ): Promise<EngineCommandResult> {
    const runOnce = () => this.installService(port)

    let attempt = await runOnce()
    // Race window: when the previous engine has active aiohttp/WebSocket
    // clients, `launchctl bootout` returns before the old process has
    // fully exited and the immediate bootstrap returns
    // `Bootstrap failed: 5: Input/output error`. The engine-side teardown
    // now polls launchctl to wait the label out, but we keep a UI-level
    // retry as a belt-and-suspenders for older bundled engines that ship
    // without that wait.
    if (
      !attempt.ok
      && /Bootstrap failed: 5|Input\/output error/i.test(`${attempt.stderr}\n${attempt.stdout}`)
    ) {
      await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_DELAY_MS))
      attempt = await runOnce()
    }
    return attempt
  }

  private async reinstallBundledEngineService(
    port: number,
    logPath?: string | null,
  ): Promise<EngineBootstrapState | null> {
    this.setState({
      phase: 'updating',
      operation: 'update',
      message: 'Updating local engine service...',
      error: null,
    })

    const install = await this.runInstallServiceWithRetry(port)
    if (!install.ok) {
      const executablePath = install.executablePath ?? await resolveExecutable()
      const manifest = await readEngineManifest(executablePath)
      const status = await this.status()
      if (
        status.payload?.running
        && !this.requiresWindowsServiceInstall(status.payload)
        && this.serviceMatchesBundledEngine(status.payload, executablePath, manifest)
      ) {
        const health = await this.waitForHealth(port, logPath)
        if (health.ok) {
          return this.setState({
            phase: 'ready',
            operation: null,
            message: health.message,
            executablePath,
            serviceInstalled: true,
            serviceRunning: true,
            version: health.version,
            healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
            error: null,
          })
        }
      }
      return this.setState({
        phase: 'error',
        operation: 'update',
        message: install.stderr || install.stdout || 'Local engine service update failed.',
        executablePath: install.executablePath,
        serviceInstalled: false,
        serviceRunning: false,
        healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
        error: install.stderr || install.stdout || 'install-service failed',
      })
    }

    this.setState({
      phase: 'starting',
      operation: 'update',
      message: 'Verifying updated local engine health...',
      executablePath: install.executablePath,
      serviceInstalled: true,
      serviceRunning: true,
      healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
    })

    // On macOS/Linux, install-service writes the launchd/systemd unit and
    // bootstraps it with RunAtLoad=true — the engine is already starting.
    // Skip the explicit start() (which on macOS does `launchctl kickstart -k`
    // and would kill+restart the freshly-loaded service) and probe health
    // directly. Only fall back to start() if the service somehow didn't come
    // up on its own.
    let health = await this.waitForHealth(port, logPath)
    if (!health.ok) {
      const start = await this.start()
      if (!start.ok) {
        return this.setState({
          phase: 'error',
          operation: 'update',
          message: start.stderr || start.stdout || 'Updated local engine service failed to start.',
          executablePath: start.executablePath,
          serviceInstalled: true,
          serviceRunning: false,
          healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
          error: start.stderr || start.stdout || 'start failed',
        })
      }
      health = await this.waitForHealth(port, logPath)
    }

    if (!health.ok) {
      return this.setState({
        phase: 'error',
        operation: 'update',
        message: health.message,
        serviceInstalled: true,
        serviceRunning: true,
        healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
        version: null,
        error: health.error ?? health.message,
      })
    }

    return this.setState({
      phase: 'ready',
      operation: null,
      message: health.message,
      serviceInstalled: true,
      serviceRunning: true,
      version: health.version,
      healthUrl: `http://${DEFAULT_HOST}:${port}/health`,
      error: null,
    })
  }

  async repairLocalEngineService(): Promise<EngineBootstrapState> {
    this.setState({
      phase: 'repairing',
      operation: 'repair',
      message: 'Repairing local engine service...',
      error: null,
    })

    const status = await this.status()
    const port = status.payload?.port ?? DEFAULT_PORT
    const healthUrl = `http://${DEFAULT_HOST}:${port}/health`

    const install = await this.installService(port)
    if (!install.ok) {
      return this.setState({
        phase: 'error',
        operation: 'repair',
        message: install.stderr || install.stdout || 'Local engine service repair failed.',
        executablePath: install.executablePath,
        serviceInstalled: false,
        serviceRunning: false,
        healthUrl,
        error: install.stderr || install.stdout || 'install-service failed',
      })
    }

    const start = await this.start()
    if (!start.ok) {
      return this.setState({
        phase: 'error',
        operation: 'repair',
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
      operation: 'repair',
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
        operation: 'repair',
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
      operation: null,
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
        operation: 'bootstrap',
        message: 'Checking bundled local engine...',
        error: null,
      })

      const seeded = await this.ensureBundleRuntimeConfig()
      if (!seeded.ok) {
        return this.setState({
          phase: 'error',
          operation: 'bootstrap',
          message: seeded.message,
          executablePath: this.state.executablePath,
          serviceInstalled: null,
          serviceRunning: null,
          error: seeded.error,
        })
      }

      const fastExecutablePath = await resolveExecutable()
      const bundledManifest = await readEngineManifest(fastExecutablePath)

      let cachedStatus: { result: EngineCommandResult; payload: EngineStatusPayload | null } | null = null
      const fastHealth = await this.probeHealth(DEFAULT_PORT)
      if (fastHealth.ok) {
        if (this.liveEngineMatchesBundle(fastHealth, fastExecutablePath, bundledManifest)) {
          if (process.platform !== 'win32') {
            return this.setState({
              phase: 'ready',
              operation: null,
              message: 'Local engine is ready.',
              executablePath: fastExecutablePath,
              serviceInstalled: true,
              serviceRunning: true,
              healthUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`,
              version: fastHealth.version,
              error: null,
            })
          }

          cachedStatus = await this.status()
          if (
            !cachedStatus.result.ok
            || this.requiresWindowsServiceInstall(cachedStatus.payload)
          ) {
            const updated = await this.reinstallBundledEngineService(
              DEFAULT_PORT,
              cachedStatus.payload?.log_file,
            )
            if (updated) return updated
          } else {
            return this.setState({
              phase: 'ready',
              operation: null,
              message: 'Local engine is ready.',
              executablePath: fastExecutablePath,
              serviceInstalled: true,
              serviceRunning: true,
              healthUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`,
              version: fastHealth.version,
              error: null,
            })
          }
        }
        // A live engine is responding but its identity does not match the
        // bundle. Trigger the reinstall directly — the slow status path's
        // SHA check reads from the engine state file rather than the live
        // process, so trusting it here would silently skip the swap.
        const updated = await this.reinstallBundledEngineService(
          DEFAULT_PORT,
          null,
        )
        if (updated) return updated
      }

      const status = cachedStatus ?? await this.status()
      if (!status.result.ok && !status.result.executablePath) {
        return this.setState({
          phase: 'error',
          operation: 'bootstrap',
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
        executablePath: fastExecutablePath ?? status.result.executablePath,
        serviceInstalled,
        serviceRunning,
        healthUrl,
      })

      if (
        this.requiresWindowsServiceInstall(status.payload)
        || !this.serviceMatchesBundledEngine(status.payload, fastExecutablePath, bundledManifest)
      ) {
        const updated = await this.reinstallBundledEngineService(port, status.payload?.log_file)
        if (updated) return updated
      }

      if (!serviceInstalled) {
        this.setState({
          phase: 'installing',
          operation: 'install',
          message: 'Installing local engine service...',
          serviceInstalled: false,
          serviceRunning,
        })
        const install = await this.installService(port)
        if (!install.ok) {
          return this.setState({
            phase: 'error',
            operation: 'install',
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
          operation: 'start',
          message: 'Starting local engine service...',
          serviceInstalled,
          serviceRunning: false,
        })
        const started = await this.start()
        if (!started.ok) {
          return this.setState({
            phase: 'error',
            operation: 'start',
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
        operation: serviceInstalled ? 'start' : 'install',
        message: 'Waiting for local engine health check...',
        serviceInstalled,
        serviceRunning,
        healthUrl,
      })

      const health = await this.waitForHealth(port, status.payload?.log_file)
      if (!health.ok) {
        return this.setState({
          phase: 'error',
          operation: serviceInstalled ? 'start' : 'install',
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
        operation: null,
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
