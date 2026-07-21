import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bootstrapLocalEngine,
  doctorLocalEngine,
  getBootstrapState,
  getLocalEngineStatus,
  hasDesktopEngineManager,
  installLocalEngineService,
  repairLocalEngineService,
  setEngineModeHint,
  startLocalEngine,
  stopLocalEngine,
  upgradeLocalEngine,
} from './desktop'

type ElectronApi = NonNullable<Window['electronAPI']>

function setElectronApi(api: Partial<ElectronApi> | undefined): void {
  Object.defineProperty(window, 'electronAPI', {
    value: api,
    configurable: true,
    writable: true,
  })
}

describe('desktop engine bridge', () => {
  beforeEach(() => {
    setElectronApi(undefined)
  })

  afterEach(() => {
    setElectronApi(undefined)
    vi.restoreAllMocks()
  })

  it('reports no desktop manager when electronAPI is absent', () => {
    expect(hasDesktopEngineManager()).toBe(false)
  })

  it('reports a desktop manager when bootstrap is available', () => {
    setElectronApi({ bootstrapLocalEngine: vi.fn() } as Partial<ElectronApi>)
    expect(hasDesktopEngineManager()).toBe(true)
  })

  it('returns null from every bridge call when electronAPI is absent', async () => {
    await expect(bootstrapLocalEngine()).resolves.toBeNull()
    await expect(getBootstrapState()).resolves.toBeNull()
    await expect(getLocalEngineStatus()).resolves.toBeNull()
    await expect(installLocalEngineService()).resolves.toBeNull()
    await expect(repairLocalEngineService()).resolves.toBeNull()
    await expect(startLocalEngine()).resolves.toBeNull()
    await expect(stopLocalEngine()).resolves.toBeNull()
    await expect(doctorLocalEngine()).resolves.toBeNull()
    await expect(upgradeLocalEngine()).resolves.toBeNull()
    // setEngineModeHint resolves without throwing
    await expect(setEngineModeHint('localBundle')).resolves.toBeUndefined()
  })

  it('delegates to electronAPI methods when present', async () => {
    const api = {
      bootstrapLocalEngine: vi.fn().mockResolvedValue({ phase: 'ready' }),
      setEngineModeHint: vi.fn().mockResolvedValue(undefined),
      getBootstrapState: vi.fn().mockResolvedValue({ phase: 'idle' }),
      getLocalEngineStatus: vi.fn().mockResolvedValue({ result: {}, payload: null }),
      installLocalEngineService: vi.fn().mockResolvedValue({ ok: true }),
      repairLocalEngineService: vi.fn().mockResolvedValue({ phase: 'repairing' }),
      startLocalEngine: vi.fn().mockResolvedValue({ ok: true }),
      stopLocalEngine: vi.fn().mockResolvedValue({ ok: true }),
      doctorLocalEngine: vi.fn().mockResolvedValue({ ok: true }),
      upgradeLocalEngine: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Partial<ElectronApi>
    setElectronApi(api)

    await expect(bootstrapLocalEngine({ force: true })).resolves.toEqual({ phase: 'ready' })
    expect((api.bootstrapLocalEngine as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ force: true })

    await setEngineModeHint('remoteManual')
    expect((api.setEngineModeHint as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('remoteManual')

    await expect(getBootstrapState()).resolves.toEqual({ phase: 'idle' })
    await expect(getLocalEngineStatus()).resolves.toEqual({ result: {}, payload: null })
    await expect(installLocalEngineService()).resolves.toEqual({ ok: true })
    await expect(repairLocalEngineService()).resolves.toEqual({ phase: 'repairing' })
    await expect(startLocalEngine()).resolves.toEqual({ ok: true })
    await expect(stopLocalEngine()).resolves.toEqual({ ok: true })
    await expect(doctorLocalEngine()).resolves.toEqual({ ok: true })
    await expect(upgradeLocalEngine('custom-pkg')).resolves.toEqual({ ok: true })
    expect((api.upgradeLocalEngine as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('custom-pkg')
  })
})
