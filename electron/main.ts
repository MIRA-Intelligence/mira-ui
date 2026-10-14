import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, net, powerMonitor, safeStorage, shell } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import { join } from 'path'
import { LocalEngineManager } from './engine/manager'
import { getLastDeploymentMode, getSshMiraPath, isDeploymentModeHint, setLastDeploymentMode, setSshMiraPath } from './appState'
import { registerUpdateCheck, scheduleBootCheck } from './updateCheck'
import { isMainFrameSender, readGatewayToken } from './engineToken'
import { RemoteSshManager, defaultRemoteSshDeps, readSshConfigHosts } from './remoteSsh'
import { AskpassService } from './sshAskpass'
import { SshPromptBroker } from './sshPrompt'
import { SESSION_FILE, TEAM_SERVER_CHANNELS, TeamServerManager, registerTeamServerIpc, safeStorageCodec } from './teamServer'
import { initializeDesktopDiagnostics, logDesktopEvent, pruneNativeCrashDumps, recordRendererDiagnostic } from './diagnostics'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const EXPORT_IN_PROGRESS = 'Diagnostic export already in progress'
const STORAGE_UNAVAILABLE = 'Diagnostic storage unavailable'
const miraHome = () => process.env.MIRA_HOME || path.join(app.getPath('home'), '.mira')
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const diagnostics = hasSingleInstanceLock ? initializeDesktopDiagnostics() : null
if (hasSingleInstanceLock) {
  // Listen without suppressing Node's normal fatal exception behavior.
  process.on('uncaughtExceptionMonitor', (error) => {
    logDesktopEvent('process.uncaught_exception', {}, error, 'CRITICAL')
  })
  // Record only: Electron keeps running after a stray rejection (e.g. an
  // external link no installed app can open), and so should the desktop shell.
  process.on('unhandledRejection', (error) => {
    logDesktopEvent('process.unhandled_rejection', {}, error, 'CRITICAL')
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
// Remote-SSH login prompts (password, passphrase, one-time code, unknown host
// key) are shown by the renderer; answers go straight back to ssh.
const sshPrompts = new SshPromptBroker({
  send: (channel, payload) => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return false
    mainWindow.webContents.send(channel, payload)
    return true
  },
})
const sshAskpass = new AskpassService({
  helperDir: () => path.join(app.getPath('userData'), 'ssh-askpass'),
  nodePath: process.execPath,
})
const remoteSsh = hasSingleInstanceLock
  ? new RemoteSshManager({
    ...defaultRemoteSshDeps((event, fields) => logDesktopEvent(event, fields)),
    openAskpass: (handler) => sshAskpass.open(handler),
    controlDir: () => sshAskpass.controlDir(),
    prompt: (request, signal) => sshPrompts.request(request, signal),
    lastMiraPaths: { get: getSshMiraPath, set: setSshMiraPath },
  })
  : null
// Mira Server sign-in: login and refresh run here so the refresh token never
// reaches the renderer (see teamServer.ts).
const teamServer = hasSingleInstanceLock
  ? new TeamServerManager({
    fetch: (url, init) => net.fetch(url, init),
    storePath: () => path.join(app.getPath('userData'), SESSION_FILE),
    codec: safeStorageCodec(safeStorage),
    log: (event, fields) => logDesktopEvent(event, fields),
  })
  : null

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
    shell.openExternal(url).catch((error) => logDesktopEvent('shell.open_external_failed', {}, error, 'WARNING'))
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
  win.on('session-end', () => diagnostics?.markCleanShutdown())
  // A reloaded renderer has lost its prompt dialog; cancel instead of waiting.
  win.webContents.on('did-start-loading', () => sshPrompts.cancelAll())

  // Load failures are also reported through did-fail-load; never let the
  // returned promise become an unhandled rejection.
  const loading = process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(join(__dirname, '../dist/index.html'))
  void loading?.catch((error) => logDesktopEvent('renderer.load_rejected', { window_id: win.id }, error, 'ERROR'))

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

function initializeApp() {
  if (!engineManager || !remoteSsh || !teamServer) return
  // OS shutdown/logoff can end the process without emitting will-quit; Windows
  // reports it per window (session-end), Linux/macOS through powerMonitor.
  powerMonitor.on('shutdown', () => diagnostics?.markCleanShutdown())
  // Remote-SSH: forwarded connections rarely survive sleep; ssh children must
  // not outlive the app.
  powerMonitor.on('resume', () => {
    remoteSsh.handleResume()
    teamServer.handleResume()
  })
  app.on('will-quit', () => {
    remoteSsh.dispose()
    teamServer.dispose()
    sshPrompts.cancelAll()
    void sshAskpass.close()
  })
  remoteSsh.onStatus((status) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('remote-ssh:status', status)
  })
  // Install output (pip/uv progress) goes to the install dialog only; it is
  // not written to the desktop log.
  // Access tokens (never refresh tokens) follow sign-in, refresh and sign-out.
  teamServer.onSession((event) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(TEAM_SERVER_CHANNELS.changed, event)
  })
  remoteSsh.onInstallOutput((chunk) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('remote-ssh:install-output', chunk)
  })

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
  const exportFailureMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : ''
    if (message === EXPORT_IN_PROGRESS) return 'A diagnostic export is already in progress. / 诊断文件正在导出中，请稍候。'
    if (message === STORAGE_UNAVAILABLE) return 'Diagnostic storage is unavailable on this device. / 本机诊断存储不可用。'
    return 'Could not save the diagnostic file. Please try another location. / 无法保存诊断文件，请换一个位置重试。'
  }
  const exportDesktopDiagnostics = async (includeLocalEngine: boolean): Promise<string | null> => {
    if (!diagnostics) throw new Error(STORAGE_UNAVAILABLE)
    if (exportInFlight) throw new Error(EXPORT_IN_PROGRESS)
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
          const root = await realpath(path.join(miraHome(), 'runtime', 'diagnostics'))
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
      void getLastDeploymentMode().then((mode) => exportDesktopDiagnostics(mode === null || mode === 'localBundle'))
        .catch((error) => {
          logDesktopEvent('diagnostics.export_failed', {}, error)
          dialog.showErrorBox('MIRA diagnostics', exportFailureMessage(error))
        })
    } }] },
  ]))

  ipcMain.handle('engine:bootstrap', async (_event, options?: { force?: boolean }) => engineManager.bootstrapLocalEngine(options))
  ipcMain.handle('engine:gateway-token', async (event) => (
    isMainFrameSender(event, mainWindow?.webContents) ? readGatewayToken(miraHome()) : null
  ))
  const requireMainFrame = (event: IpcMainInvokeEvent) => {
    if (!isMainFrameSender(event, mainWindow?.webContents)) throw new Error('Invalid remote SSH sender')
  }
  ipcMain.handle('remote-ssh:connect', async (event, host: unknown, miraCommand: unknown) => {
    requireMainFrame(event)
    if (typeof host !== 'string') throw new Error('Invalid remote SSH host')
    if (miraCommand !== undefined && miraCommand !== null && typeof miraCommand !== 'string') throw new Error('Invalid remote mira command')
    return remoteSsh.connect(host, { miraCommand })
  })
  ipcMain.handle('remote-ssh:disconnect', async (event) => {
    requireMainFrame(event)
    return remoteSsh.disconnect()
  })
  ipcMain.handle('remote-ssh:status', async (event) => {
    requireMainFrame(event)
    return remoteSsh.status()
  })
  ipcMain.handle('remote-ssh:prompt-response', async (event, id: unknown, answer: unknown) => {
    requireMainFrame(event)
    return sshPrompts.respond(id, answer)
  })
  ipcMain.handle('remote-ssh:install-plan', async (event) => {
    requireMainFrame(event)
    return remoteSsh.installPlan()
  })
  ipcMain.handle('remote-ssh:install', async (event) => {
    requireMainFrame(event)
    return remoteSsh.install()
  })
  ipcMain.handle('remote-ssh:install-cancel', async (event) => {
    requireMainFrame(event)
    return remoteSsh.cancelInstall()
  })
  ipcMain.handle('remote-ssh:token', async (event) => (
    isMainFrameSender(event, mainWindow?.webContents) ? remoteSsh.getToken() : null
  ))
  ipcMain.handle('remote-ssh:hosts', async (event) => (
    isMainFrameSender(event, mainWindow?.webContents) ? readSshConfigHosts(app.getPath('home')) : []
  ))
  registerTeamServerIpc(ipcMain, teamServer, (event) => isMainFrameSender(event as IpcMainInvokeEvent, mainWindow?.webContents))
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
    if (!isDeploymentModeHint(mode)) return false
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
    const lastMode = await getLastDeploymentMode()
    if (lastMode !== null && lastMode !== 'localBundle') return
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
