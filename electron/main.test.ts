import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const windows: MockBrowserWindow[] = []

  class MockBrowserWindow {
    static getAllWindows = vi.fn(() => windows)
    static getFocusedWindow = vi.fn(() => windows.at(-1) ?? null)

    isMinimized = vi.fn(() => true)
    restore = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    on = vi.fn()
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    }

    constructor() {
      windows.push(this)
    }
  }

  return {
    handlers,
    windows,
    hasLock: true,
    app: {
      requestSingleInstanceLock: vi.fn(() => electronMock.hasLock),
      quit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler)
      }),
      whenReady: vi.fn(() => new Promise<void>(() => {})),
      isReady: vi.fn(() => true),
      exit: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow,
    dialog: {
      showOpenDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(async (_url: string) => {}),
    },
    powerMonitor: {
      on: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  dialog: electronMock.dialog,
  ipcMain: electronMock.ipcMain,
  shell: electronMock.shell,
  powerMonitor: electronMock.powerMonitor,
}))

vi.mock('./engine/manager', () => ({
  LocalEngineManager: class {},
}))

vi.mock('./appState', () => ({
  getLastDeploymentMode: vi.fn(),
  setLastDeploymentMode: vi.fn(),
}))

vi.mock('./updateCheck', () => ({
  registerUpdateCheck: vi.fn(),
  scheduleBootCheck: vi.fn(),
}))

vi.mock('./diagnostics', () => ({
  initializeDesktopDiagnostics: vi.fn(() => ({ bootId: 'test', markCleanShutdown: vi.fn() })),
  logDesktopEvent: vi.fn(),
  recordRendererDiagnostic: vi.fn(),
  pruneNativeCrashDumps: vi.fn(() => 0),
}))

describe('Electron single-instance lifecycle', () => {
  let uncaughtListeners: NodeJS.UncaughtExceptionListener[]
  let rejectionListeners: NodeJS.UnhandledRejectionListener[]
  beforeEach(() => {
    uncaughtListeners = process.listeners('uncaughtExceptionMonitor')
    rejectionListeners = process.listeners('unhandledRejection')
    vi.resetModules()
    electronMock.handlers.clear()
    electronMock.windows.length = 0
    electronMock.hasLock = true
    vi.clearAllMocks()
  })
  afterEach(() => {
    for (const listener of process.listeners('uncaughtExceptionMonitor')) if (!uncaughtListeners.includes(listener)) process.removeListener('uncaughtExceptionMonitor',listener)
    for (const listener of process.listeners('unhandledRejection')) if (!rejectionListeners.includes(listener)) process.removeListener('unhandledRejection',listener)
  })

  it('quits before startup when another app instance owns the lock', async () => {
    electronMock.hasLock = false

    await import('./main')

    expect(electronMock.app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(electronMock.app.quit).toHaveBeenCalledOnce()
    expect(electronMock.app.whenReady).not.toHaveBeenCalled()
  })

  it('focuses the existing window when a second launch is attempted', async () => {
    await import('./main')
    const onSecondInstance = electronMock.handlers.get('second-instance')
    expect(onSecondInstance).toBeTypeOf('function')

    onSecondInstance?.()
    expect(electronMock.windows).toHaveLength(1)
    const window = electronMock.windows[0]

    onSecondInstance?.()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('records renderer termination and unresponsiveness outside the renderer', async () => {
    await import('./main')
    electronMock.handlers.get('second-instance')?.()
    const window = electronMock.windows[0]
    const onGone = window.webContents.on.mock.calls.find(([event])=>event === 'render-process-gone')?.[1]
    onGone?.({}, { reason: 'crashed', exitCode: 11 })
    const { logDesktopEvent } = await import('./diagnostics')
    expect(logDesktopEvent).toHaveBeenCalledWith('renderer.process_gone',expect.objectContaining({ reason: 'crashed', exit_code: 11 }),undefined,'CRITICAL')
    const onHang = window.on.mock.calls.find(([event])=>event === 'unresponsive')?.[1]
    onHang?.()
    expect(logDesktopEvent).toHaveBeenCalledWith('renderer.unresponsive',expect.any(Object),undefined,'ERROR')
  })

  it('keeps running after a stray promise rejection and records it', async () => {
    await import('./main')
    const listener = process.listeners('unhandledRejection').find((item)=>!rejectionListeners.includes(item))
    expect(listener).toBeTypeOf('function')
    listener?.(new Error('no handler for slack://'), Promise.resolve())
    const { logDesktopEvent } = await import('./diagnostics')
    expect(logDesktopEvent).toHaveBeenCalledWith('process.unhandled_rejection',{},expect.any(Error),'CRITICAL')
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('handles external links nobody can open without an unhandled rejection', async () => {
    await import('./main')
    electronMock.handlers.get('second-instance')?.()
    const window = electronMock.windows[0]
    electronMock.shell.openExternal.mockRejectedValueOnce(new Error('No application to open URL'))
    const openHandler = window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => unknown
    expect(openHandler({ url: 'slack://open' })).toEqual({ action: 'deny' })
    await new Promise((resolve)=>setTimeout(resolve,0))
    const { logDesktopEvent } = await import('./diagnostics')
    expect(logDesktopEvent).toHaveBeenCalledWith('shell.open_external_failed',{},expect.any(Error),'WARNING')
  })

  it('marks a clean shutdown when Windows ends the session', async () => {
    await import('./main')
    electronMock.handlers.get('second-instance')?.()
    const window = electronMock.windows[0]
    const onSessionEnd = window.on.mock.calls.find(([event])=>event === 'session-end')?.[1]
    expect(onSessionEnd).toBeTypeOf('function')
    onSessionEnd?.()
    const { initializeDesktopDiagnostics } = await import('./diagnostics')
    const diagnostics = vi.mocked(initializeDesktopDiagnostics).mock.results[0]?.value as { markCleanShutdown: () => void }
    expect(diagnostics.markCleanShutdown).toHaveBeenCalled()
  })
})
