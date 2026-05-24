import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockElectron = vi.hoisted(() => ({
  homeDir: '',
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => mockElectron.homeDir,
    getPath: () => mockElectron.homeDir,
  },
}))

import { LocalEngineManager } from './manager'

describe('LocalEngineManager', () => {
  const originalEnginePath = process.env.MIRA_ENGINE_PATH
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mira-ui-engine-manager-'))
    mockElectron.homeDir = tempDir

    const executable = path.join(tempDir, 'mira-engine')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(executable, 0o755)
    process.env.MIRA_ENGINE_PATH = executable
  })

  afterEach(async () => {
    if (originalEnginePath === undefined) {
      delete process.env.MIRA_ENGINE_PATH
    } else {
      process.env.MIRA_ENGINE_PATH = originalEnginePath
    }
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('skips the slow status command when the local engine is already healthy', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response('{"status":"ok"}', { status: 200 })
      }
      if (url.endsWith('/version')) {
        return Response.json({ agent_version: '0.4.0' })
      }
      return new Response(null, { status: 404 })
    })
    const statusSpy = vi.spyOn(LocalEngineManager.prototype, 'status')

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(state.phase).toBe('ready')
    expect(state.version).toBe('0.4.0')
    expect(statusSpy).not.toHaveBeenCalled()
  })

  it('reinstalls directly (skipping the slow status path) when the live engine boot SHA differs from the bundled manifest', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response('{"status":"ok"}', { status: 200 })
      }
      if (url.endsWith('/version')) {
        return Response.json({
          agent_version: '0.3.0',
          engine_sha256: 'old-sha',
          engine_sha256_at_boot: 'old-sha',
        })
      }
      return new Response(null, { status: 404 })
    })
    const statusSpy = vi.spyOn(LocalEngineManager.prototype, 'status')
    const reinstallSpy = vi
      .spyOn(LocalEngineManager.prototype as unknown as {
        reinstallBundledEngineService: LocalEngineManager['bootstrapLocalEngine']
      }, 'reinstallBundledEngineService')
      .mockResolvedValue({
        phase: 'ready',
        message: 'updated',
        executablePath: executable,
        healthUrl: '',
        version: '0.4.0',
        operation: null,
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      })

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(state.phase).toBe('ready')
    expect(reinstallSpy).toHaveBeenCalled()
    // The slow `mira-engine status` CLI reads SHA from the state file, not
    // the live process — trusting it here would silently skip the swap.
    expect(statusSpy).not.toHaveBeenCalled()
  })

  it('forces a reinstall when the live engine does not expose engine_sha256_at_boot (legacy engine)', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response('{"status":"ok"}', { status: 200 })
      }
      if (url.endsWith('/version')) {
        // Legacy engine re-reads the manifest on every call. After a DMG
        // swap, its `engine_sha256` matches the *new* bundle even though
        // the running process is still the old one. The UI must NOT trust
        // this field alone — only the explicit `engine_sha256_at_boot`
        // marker proves the engine snapshots its identity at startup.
        return Response.json({ agent_version: '0.3.0', engine_sha256: 'bundled-sha' })
      }
      return new Response(null, { status: 404 })
    })
    const reinstallSpy = vi
      .spyOn(LocalEngineManager.prototype as unknown as {
        reinstallBundledEngineService: LocalEngineManager['bootstrapLocalEngine']
      }, 'reinstallBundledEngineService')
      .mockResolvedValue({
        phase: 'ready',
        message: 'updated',
        executablePath: executable,
        healthUrl: '',
        version: '0.4.0',
        operation: null,
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      })

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(state.phase).toBe('ready')
    expect(reinstallSpy).toHaveBeenCalled()
  })

  it('reports the offending process when the engine port is already taken', async () => {
    const manager = new LocalEngineManager() as unknown as {
      diagnoseBootstrapFailure: (
        logTail: string,
        port: number,
        holder: { pid: number; command: string } | null,
      ) => { message: string; error: string }
    }

    const diagnosis = manager.diagnoseBootstrapFailure('', 18790, { pid: 4242, command: 'node' })

    expect(diagnosis.message).toContain('18790')
    expect(diagnosis.message).toContain('node')
    expect(diagnosis.message).toContain('4242')
  })

  it('takes the fast path when the live engine boot SHA matches the bundled manifest', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response('{"status":"ok"}', { status: 200 })
      }
      if (url.endsWith('/version')) {
        return Response.json({
          agent_version: '0.4.0',
          engine_sha256: 'bundled-sha',
          engine_sha256_at_boot: 'bundled-sha',
        })
      }
      return new Response(null, { status: 404 })
    })
    const statusSpy = vi.spyOn(LocalEngineManager.prototype, 'status')

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(state.phase).toBe('ready')
    expect(state.version).toBe('0.4.0')
    expect(statusSpy).not.toHaveBeenCalled()
  })

  it('retries install-service once when the engine reports Bootstrap failed: 5', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    // Fast path probes fail so we fall through to the slow status path.
    // After the second install attempt the engine becomes healthy.
    let healthCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        healthCalls += 1
        return new Response('{}', { status: healthCalls === 1 ? 503 : 200 })
      }
      if (url.endsWith('/version')) {
        return Response.json({ agent_version: '0.4.0', engine_sha256: 'bundled-sha' })
      }
      return new Response(null, { status: 404 })
    })
    vi.spyOn(LocalEngineManager.prototype, 'status').mockResolvedValue({
      result: {
        ok: true,
        code: 0,
        stdout: '{}',
        stderr: '',
        command: [executable, 'status'],
        executablePath: executable,
      },
      payload: {
        installed: true,
        running: true,
        port: 18790,
        engine_manifest: { sha256: 'old-sha' },
      },
    })
    const installSpy = vi
      .spyOn(LocalEngineManager.prototype, 'installService')
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stdout: '',
        stderr: 'Bootstrap failed: 5: Input/output error',
        command: [executable, 'install-service'],
        executablePath: executable,
      })
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stdout: 'launchd service installed',
        stderr: '',
        command: [executable, 'install-service'],
        executablePath: executable,
      })

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(installSpy).toHaveBeenCalledTimes(2)
    expect(state.phase).toBe('ready')
    expect(state.error).toBeNull()
  }, 15000)

  it('does not retry install-service when the failure is not a bootstrap race', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) return new Response(null, { status: 503 })
      return new Response(null, { status: 404 })
    })
    vi.spyOn(LocalEngineManager.prototype, 'status').mockResolvedValue({
      result: {
        ok: true,
        code: 0,
        stdout: '{}',
        stderr: '',
        command: [executable, 'status'],
        executablePath: executable,
      },
      payload: {
        installed: true,
        running: true,
        port: 18790,
        engine_manifest: { sha256: 'old-sha' },
      },
    })
    const installSpy = vi
      .spyOn(LocalEngineManager.prototype, 'installService')
      .mockResolvedValue({
        ok: false,
        code: 1,
        stdout: '',
        stderr: 'mira-engine: workspace inaccessible',
        command: [executable, 'install-service'],
        executablePath: executable,
      })

    await new LocalEngineManager().bootstrapLocalEngine()

    expect(installSpy).toHaveBeenCalledTimes(1)
  })

  it('treats a running matching launchd service as ready when bootstrap reports already-loaded failure', async () => {
    const executable = process.env.MIRA_ENGINE_PATH as string
    await writeFile(
      path.join(path.dirname(executable), 'mira-engine.manifest.json'),
      JSON.stringify({ sha256: 'bundled-sha' }),
      'utf8',
    )
    let healthCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        healthCalls += 1
        return new Response('{"status":"ok"}', { status: healthCalls === 1 ? 503 : 200 })
      }
      if (url.endsWith('/version')) {
        return Response.json({ agent_version: '0.4.0' })
      }
      return new Response(null, { status: 404 })
    })
    vi.spyOn(LocalEngineManager.prototype, 'status')
      .mockResolvedValueOnce({
        result: {
          ok: true,
          code: 0,
          stdout: '{}',
          stderr: '',
          command: [executable, 'status'],
          executablePath: executable,
        },
        payload: {
          installed: true,
          running: true,
          port: 18790,
          engine_manifest: { sha256: 'old-sha' },
        },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          code: 0,
          stdout: '{}',
          stderr: '',
          command: [executable, 'status'],
          executablePath: executable,
        },
        payload: {
          installed: true,
          running: true,
          port: 18790,
          engine_manifest: { sha256: 'bundled-sha' },
          launchd_program: executable,
        },
      })
    vi.spyOn(LocalEngineManager.prototype, 'installService').mockResolvedValue({
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'Bootstrap failed: 5: Input/output error',
      command: [executable, 'install-service'],
      executablePath: executable,
    })

    const state = await new LocalEngineManager().bootstrapLocalEngine()

    expect(state.phase).toBe('ready')
    expect(state.version).toBe('0.4.0')
    expect(state.error).toBeNull()
  })
})
