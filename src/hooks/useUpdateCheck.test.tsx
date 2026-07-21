import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateCheck } from './useUpdateCheck'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

type ElectronApi = NonNullable<Window['electronAPI']>

function setElectronApi(api: Partial<ElectronApi> | undefined): void {
  Object.defineProperty(window, 'electronAPI', {
    value: api,
    configurable: true,
    writable: true,
  })
}

const uiInitial = useUiStore.getState()

describe('useUpdateCheck', () => {
  beforeEach(() => {
    setElectronApi(undefined)
    useUiStore.setState(uiInitial, true)
    useSettingsStore.setState({ receivePrereleases: false })
  })

  afterEach(() => {
    setElectronApi(undefined)
    vi.restoreAllMocks()
  })

  it('does nothing when electronAPI is unavailable', () => {
    const { result } = renderHook(() => useUpdateCheck())
    act(() => result.current.check())
    expect(useUiStore.getState().availableUpdate).toBeNull()
  })

  it('writes the discovered update into the ui store on initial mount', async () => {
    const info = { version: '2.0.0' }
    const checkForUpdates = vi.fn().mockResolvedValue(info)
    setElectronApi({ checkForUpdates } as unknown as Partial<ElectronApi>)

    await act(async () => {
      renderHook(() => useUpdateCheck())
      await Promise.resolve()
    })

    expect(checkForUpdates).toHaveBeenCalledWith({ includePrereleases: false, forceRefresh: false })
    expect(useUiStore.getState().availableUpdate).toEqual(info)
  })

  it('clears the available update when the check rejects', async () => {
    const checkForUpdates = vi.fn().mockRejectedValue(new Error('offline'))
    setElectronApi({ checkForUpdates } as unknown as Partial<ElectronApi>)
    useUiStore.setState({ availableUpdate: { version: 'x' } as never })

    await act(async () => {
      renderHook(() => useUpdateCheck())
      await Promise.resolve()
    })

    expect(useUiStore.getState().availableUpdate).toBeNull()
  })

  it('subscribes to push events from the main process', async () => {
    const unsubscribe = vi.fn()
    let pushed: ((info: unknown) => void) | null = null
    const onUpdateAvailable = vi.fn((cb: (info: unknown) => void) => {
      pushed = cb
      return unsubscribe
    })
    setElectronApi({ onUpdateAvailable } as unknown as Partial<ElectronApi>)

    const { unmount } = renderHook(() => useUpdateCheck())
    expect(onUpdateAvailable).toHaveBeenCalled()

    act(() => pushed?.({ version: '3.1.4' }))
    expect(useUiStore.getState().availableUpdate).toEqual({ version: '3.1.4' })

    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
