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
})
