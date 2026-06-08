import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { join } from 'path'
import { LocalEngineManager } from './engine/manager'
import { registerUpdateCheck, scheduleBootCheck } from './updateCheck'

const engineManager = new LocalEngineManager()
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

app.whenReady().then(() => {
  ipcMain.handle('engine:bootstrap', async () => engineManager.bootstrapLocalEngine())
  ipcMain.handle('engine:bootstrap-state', async () => engineManager.getState())
  ipcMain.handle('engine:status', async () => engineManager.status())
  ipcMain.handle('engine:start', async () => engineManager.start())
  ipcMain.handle('engine:stop', async () => engineManager.stop())
  ipcMain.handle('engine:doctor', async () => engineManager.doctor())
  ipcMain.handle('engine:install-service', async () => engineManager.installService())
  ipcMain.handle('engine:repair-service', async () => engineManager.repairLocalEngineService())
  ipcMain.handle('engine:upgrade', async (_event, packageName?: string) => {
    return engineManager.upgrade(packageName || 'mira-engine')
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
  void engineManager.bootstrapLocalEngine().catch(() => {})
  createWindow()
  // Renderer carries the "include prereleases" preference; on first boot we
  // default to stable-only and let the renderer re-trigger via IPC after it
  // has hydrated its persisted setting.
  scheduleBootCheck({ includePrereleases: false })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
