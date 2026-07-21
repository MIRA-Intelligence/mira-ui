import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      whenReady: vi.fn(() => ({ then: vi.fn() })),
      isReady: vi.fn(() => true),
    },
    BrowserWindow: MockBrowserWindow,
    dialog: {
      showOpenDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  dialog: electronMock.dialog,
  ipcMain: electronMock.ipcMain,
  shell: electronMock.shell,
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

describe('Electron single-instance lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    electronMock.handlers.clear()
    electronMock.windows.length = 0
    electronMock.hasLock = true
    vi.clearAllMocks()
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
})
