import { spawn } from 'child_process'
import { access } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { app } from 'electron'
import path from 'path'

export type LocalEnginePhase = 'idle' | 'checking' | 'installing' | 'starting' | 'ready' | 'error'

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
}

const DEFAULT_PORT = 18790
const DEFAULT_HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 45_000
const COMMAND_TIMEOUT_MS = 120_000

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

  async installService(port = DEFAULT_PORT): Promise<EngineCommandResult> {
    return this.runCommand(['install-service', '--host', DEFAULT_HOST, '--port', String(port)])
  }

  async upgrade(packageName = 'mira-engine'): Promise<EngineCommandResult> {
    return this.runCommand(['upgrade', '--package', packageName], { timeoutMs: 180_000 })
  }

  private async waitForHealth(port = DEFAULT_PORT): Promise<{ ok: boolean; version: string | null; message: string }> {
    const base = `http://${DEFAULT_HOST}:${port}`
    const startedAt = Date.now()
    while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
      try {
        const healthResp = await fetch(`${base}/health`)
        if (healthResp.ok) {
          let version: string | null = null
          try {
            const versionResp = await fetch(`${base}/version`)
            if (versionResp.ok) {
              const payload = await versionResp.json() as { agent_version?: string }
              version = typeof payload.agent_version === 'string' ? payload.agent_version : null
            }
          } catch {
            // Ignore version probe failures when health already passed.
          }
          return { ok: true, version, message: 'Local engine is ready.' }
        }
      } catch {
        // keep polling until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return {
      ok: false,
      version: null,
      message: `Timed out waiting for local engine health on ${base}/health.`,
    }
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
      })

      const health = await this.waitForHealth(port)
      if (!health.ok) {
        return this.setState({
          phase: 'error',
          message: health.message,
          serviceInstalled,
          serviceRunning,
          version: null,
          error: health.message,
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
