import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { join } from 'path'
import { LocalEngineManager } from './engine/manager'
import { getLastDeploymentMode, setLastDeploymentMode } from './appState'
import { registerUpdateCheck, scheduleBootCheck } from './updateCheck'
import { initializeDesktopDiagnostics, logDesktopEvent, pruneNativeCrashDumps, recordRendererDiagnostic } from './diagnostics'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const hasSingleInstanceLock = app.requestSingleInstanceLock()
const diagnostics = hasSingleInstanceLock ? initializeDesktopDiagnostics() : null
if (hasSingleInstanceLock) {
  // Listen without suppressing Node's normal fatal exception behavior.
  process.on('uncaughtExceptionMonitor', (error) => {
    logDesktopEvent('process.uncaught_exception', {}, error, 'CRITICAL')
  })
  process.on('unhandledRejection', (error) => {
    logDesktopEvent('process.unhandled_rejection', {}, error, 'CRITICAL')
    app.exit(1)
  })
  try {
    const pruned = pruneNativeCrashDumps(app.getPath('crashDumps'))
    if (pruned) logDesktopEvent('diagnostics.native_dumps_pruned', { count: pruned })
    crashReporter.start({ uploadToServer: false, globalExtra: { mira_boot_id: diagnostics?.bootId ?? 'unknown' } })
  } catch (error) { logDesktopEvent('crash_reporter.unavailable', {}, error) }
  app.on('child-process-gone', (_event, details) => {
    logDesktopEvent('process.child_gone', { process_type: details.type, reason: details.reason, exit_code: details.exitCode }, undefined, 'ERROR')
  })
  app.on('will-quit', () => diagnostics?.markCleanShutdown())
}
const engineManager = hasSingleInstanceLock ? new LocalEngineManager() : null
let mainWindow: BrowserWindow | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logDesktopEvent('renderer.process_gone', { window_id: win.id, reason: details.reason, exit_code: details.exitCode }, undefined, 'CRITICAL')
  })
  win.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame) logDesktopEvent('renderer.load_failed', { window_id: win.id, code }, undefined, 'ERROR')
  })
  win.on('unresponsive', () => logDesktopEvent('renderer.unresponsive', { window_id: win.id }, undefined, 'ERROR'))
  win.on('responsive', () => logDesktopEvent('renderer.responsive', { window_id: win.id }))

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

function initializeApp() {
  if (!engineManager) return

  let received = 0
  let dropped = 0
  let bucketStarted = Date.now()
  ipcMain.on('diagnostics:record', (event, payload: unknown) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return
    if (Date.now() - bucketStarted >= 1000) {
      if (dropped) logDesktopEvent('diagnostics.renderer_rate_limited', { count: dropped }, undefined, 'WARNING')
      bucketStarted = Date.now(); received = 0; dropped = 0
    }
    if (++received > 60) { dropped += 1; return }
    recordRendererDiagnostic(payload)
  })
  let exportInFlight = false
  const exportDesktopDiagnostics = async (includeLocalEngine: boolean): Promise<string | null> => {
    if (!diagnostics) throw new Error('Diagnostic storage unavailable')
    if (exportInFlight) throw new Error('Diagnostic export already in progress')
    exportInFlight = true
    try {
      const options = {
        title: 'Export MIRA diagnostics', defaultPath: `mira-diagnostics-${Date.now()}.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      }
      const selection = mainWindow ? await dialog.showSaveDialog(mainWindow,options) : await dialog.showSaveDialog(options)
      if (selection.canceled || !selection.filePath) return null
      let engine: { path?: string; error?: string } | undefined
      if (includeLocalEngine) {
        try {
          const result = await engineManager.exportDiagnostics()
          const payload = JSON.parse(result.stdout) as { diagnostics_bundle?: string }
          if (typeof payload.diagnostics_bundle !== 'string') throw new Error('No engine bundle')
          const file = await realpath(payload.diagnostics_bundle)
          const root = await realpath(path.join(process.env.MIRA_HOME || path.join(app.getPath('home'), '.mira'), 'runtime', 'diagnostics'))
          const relative = path.relative(root, file)
          if (relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.zip') || !(await stat(file)).isFile()) throw new Error('Invalid engine bundle')
          engine = { path: file }
        } catch (error) {
          logDesktopEvent('diagnostics.engine_collection_failed', {}, error)
          engine = { error: 'engine_collection_failed' }
        }
      }
      await diagnostics.exportBundle(selection.filePath,engine,app.getPath('crashDumps'))
      shell.showItemInFolder(selection.filePath)
      return selection.filePath
    } finally { exportInFlight = false }
  }
  ipcMain.handle('diagnostics:export', async (event, options?: { includeLocalEngine?: boolean }) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid diagnostic sender')
    return exportDesktopDiagnostics(options?.includeLocalEngine === true)
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Export diagnostics / 导出诊断文件', click: () => {
      void getLastDeploymentMode().then((mode) => exportDesktopDiagnostics(mode !== 'remoteManual'))
        .catch((error) => {
          logDesktopEvent('diagnostics.export_failed', {}, error)
          dialog.showErrorBox('MIRA diagnostics', 'Could not save the diagnostic file. Please try another location.')
        })
    } }] },
  ]))

  ipcMain.handle('engine:bootstrap', async (_event, options?: { force?: boolean }) => engineManager.bootstrapLocalEngine(options))
  ipcMain.handle('engine:bootstrap-state', async () => engineManager.getState())
  ipcMain.handle('engine:status', async () => engineManager.status())
  ipcMain.handle('engine:start', async () => engineManager.start())
  ipcMain.handle('engine:stop', async () => engineManager.stop())
  ipcMain.handle('engine:restart', async () => engineManager.restart())
  ipcMain.handle('engine:doctor', async () => engineManager.doctor())
  ipcMain.handle('engine:install-service', async () => engineManager.installService())
  ipcMain.handle('engine:repair-service', async () => engineManager.repairLocalEngineService())
  ipcMain.handle('engine:upgrade', async (_event, packageName?: string) => {
    return engineManager.upgrade(packageName || 'mira-engine')
  })
  ipcMain.handle('engine:set-mode-hint', async (_event, mode: unknown) => {
    if (mode !== 'localBundle' && mode !== 'remoteManual') return false
    await setLastDeploymentMode(mode)
    return true
  })
  ipcMain.handle('dialog:select-data-path', async (_event, kind: 'file' | 'directory') => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const options: OpenDialogOptions = {
      properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
  ipcMain.handle('project:select-directory', async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
  registerUpdateCheck(() => mainWindow)
  // Pre-warm the bundled local engine only when the user's last session used
  // local mode (or on first run, where the hint is absent and the bundle
  // defaults to local). In remote mode we skip it so the app doesn't
  // install/start a local service the user isn't connecting to — the renderer
  // still drives the actual connection from its persisted deploymentMode.
  void (async () => {
    if ((await getLastDeploymentMode()) === 'remoteManual') return
    await engineManager.bootstrapLocalEngine().catch((error) => logDesktopEvent('engine.prewarm_failed', {}, error))
  })()
  createWindow()
  // Renderer carries the "include prereleases" preference; on first boot we
  // default to stable-only and let the renderer re-trigger via IPC after it
  // has hydrated its persisted setting.
  scheduleBootCheck({ includePrereleases: false })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      if (app.isReady()) createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(initializeApp).catch((error) => {
    logDesktopEvent('app.startup_failed', {}, error, 'CRITICAL')
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
