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
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
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
      on: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(async (_url: string) => {}),
    },
    powerMonitor: {
      on: vi.fn(),
    },
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn(() => ({})),
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
  Menu: electronMock.Menu,
}))

const remoteSshMock = vi.hoisted(() => ({
  deps: null as null | {
    prompt?: (request: unknown, signal: AbortSignal) => Promise<string | null>
    lastMiraPaths?: { get: (host: string) => Promise<string | null>; set: (host: string, path: string) => Promise<void> }
  },
  connect: vi.fn(async (host: string) => ({ phase: 'connected', host })),
  disconnect: vi.fn(() => ({ phase: 'idle' })),
  status: vi.fn(() => ({ phase: 'idle' })),
  getToken: vi.fn(() => 'remote-token-0123456789'),
  onStatus: vi.fn(),
  onInstallOutput: vi.fn(),
  installPlan: vi.fn(() => ({ spec: 'mira-engine>=0.4.0rc1', venv: '${MIRA_HOME:-$HOME/.mira}/venv', script: 'set -e', defaultSpec: true })),
  install: vi.fn(async () => ({ ok: true, version: '0.5.0', launcher: null, executable: null })),
  cancelInstall: vi.fn(() => true),
  handleResume: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./remoteSsh', () => ({
  RemoteSshManager: class { constructor(deps: typeof remoteSshMock.deps) { remoteSshMock.deps = deps; return remoteSshMock } },
  defaultRemoteSshDeps: vi.fn(() => ({})),
  readSshConfigHosts: vi.fn(async () => ['lab']),
}))

vi.mock('./engine/manager', () => ({
  LocalEngineManager: class {},
}))

vi.mock('./appState', () => ({
  getLastDeploymentMode: vi.fn(),
  setLastDeploymentMode: vi.fn(),
  getSshMiraPath: vi.fn(async () => '/opt/conda/bin/mira'),
  setSshMiraPath: vi.fn(async () => {}),
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

  it('serves Remote-SSH IPC only to the main window top-level frame', async () => {
    const { getLastDeploymentMode } = await import('./appState')
    vi.mocked(getLastDeploymentMode).mockResolvedValue('remoteSsh')
    electronMock.app.whenReady.mockReturnValueOnce(Promise.resolve())
    Object.assign(electronMock.app, { getPath: vi.fn(() => '/home/test') })
    await import('./main')
    await vi.waitFor(() => expect(electronMock.windows).toHaveLength(1))

    const handlers = new Map(vi.mocked(electronMock.ipcMain.handle).mock.calls as Array<[string, (...args: unknown[]) => unknown]>)
    const window = electronMock.windows[0] as unknown as { webContents: { mainFrame?: object } }
    const mainFrame = {}
    window.webContents.mainFrame = mainFrame
    const trusted = { sender: window.webContents, senderFrame: mainFrame }
    const subframe = { sender: window.webContents, senderFrame: {} }

    expect(await handlers.get('remote-ssh:connect')?.(trusted, 'lab')).toEqual({ phase: 'connected', host: 'lab' })
    expect(remoteSshMock.connect).toHaveBeenCalledWith('lab', { miraCommand: undefined })
    await handlers.get('remote-ssh:connect')?.(trusted, 'lab', '/opt/mira/bin/mira')
    expect(remoteSshMock.connect).toHaveBeenLastCalledWith('lab', { miraCommand: '/opt/mira/bin/mira' })
    await expect(handlers.get('remote-ssh:connect')?.(trusted, 'lab', 7)).rejects.toThrow('Invalid remote mira command')
    await expect(handlers.get('remote-ssh:connect')?.(subframe, 'lab')).rejects.toThrow('Invalid remote SSH sender')
    await expect(handlers.get('remote-ssh:connect')?.(trusted, 42)).rejects.toThrow('Invalid remote SSH host')
    expect(remoteSshMock.connect).toHaveBeenCalledTimes(2)

    expect(await handlers.get('remote-ssh:token')?.(trusted)).toBe('remote-token-0123456789')
    expect(await handlers.get('remote-ssh:token')?.(subframe)).toBeNull()
    expect(await handlers.get('remote-ssh:hosts')?.(trusted)).toEqual(['lab'])
    expect(await handlers.get('remote-ssh:hosts')?.(subframe)).toEqual([])
    await expect(handlers.get('remote-ssh:disconnect')?.(subframe)).rejects.toThrow()

    // Login prompts reach the renderer and only its main frame may answer.
    const send = (window as unknown as { webContents: { send: ReturnType<typeof vi.fn> } }).webContents.send
    const answer = remoteSshMock.deps!.prompt!({ host: 'lab', kind: 'secret', text: 'Password: ', retry: false }, new AbortController().signal)
    expect(send).toHaveBeenCalledWith('remote-ssh:prompt', { id: expect.any(String), host: 'lab', kind: 'secret', text: 'Password: ', retry: false })
    const promptId = (send.mock.calls.at(-1)![1] as { id: string }).id
    await expect(handlers.get('remote-ssh:prompt-response')?.(subframe, promptId, 'pw')).rejects.toThrow('Invalid remote SSH sender')
    expect(await handlers.get('remote-ssh:prompt-response')?.(trusted, 'other', 'pw')).toBe(false)
    expect(await handlers.get('remote-ssh:prompt-response')?.(trusted, promptId, 'pw')).toBe(true)
    await expect(answer).resolves.toBe('pw')

    // Installing Mira on the server: main frame only, output streamed to it.
    expect(await handlers.get('remote-ssh:install-plan')?.(trusted)).toMatchObject({ spec: 'mira-engine>=0.4.0rc1' })
    await expect(handlers.get('remote-ssh:install')?.(subframe)).rejects.toThrow('Invalid remote SSH sender')
    expect(remoteSshMock.install).not.toHaveBeenCalled()
    expect(await handlers.get('remote-ssh:install')?.(trusted)).toMatchObject({ ok: true })
    await expect(handlers.get('remote-ssh:install-cancel')?.(subframe)).rejects.toThrow('Invalid remote SSH sender')
    expect(await handlers.get('remote-ssh:install-cancel')?.(trusted)).toBe(true)
    const onOutput = remoteSshMock.onInstallOutput.mock.calls[0][0] as (chunk: string) => void
    onOutput('Collecting mira-engine\n')
    expect(send).toHaveBeenCalledWith('remote-ssh:install-output', 'Collecting mira-engine\n')
    // The last working path is kept per host in the app state file.
    expect(await remoteSshMock.deps!.lastMiraPaths!.get('lab')).toBe('/opt/conda/bin/mira')

    const onResume = vi.mocked(electronMock.powerMonitor.on).mock.calls.find(([event]) => event === 'resume')?.[1] as () => void
    onResume()
    expect(remoteSshMock.handleResume).toHaveBeenCalled()
    electronMock.handlers.get('will-quit')?.()
    expect(remoteSshMock.dispose).toHaveBeenCalled()
  })
})
