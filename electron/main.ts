import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { LocalEngineManager } from './engine/manager'

const engineManager = new LocalEngineManager()

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
}

app.whenReady().then(() => {
  ipcMain.handle('engine:bootstrap', async () => engineManager.bootstrapLocalEngine())
  ipcMain.handle('engine:bootstrap-state', async () => engineManager.getState())
  ipcMain.handle('engine:status', async () => engineManager.status())
  ipcMain.handle('engine:start', async () => engineManager.start())
  ipcMain.handle('engine:stop', async () => engineManager.stop())
  ipcMain.handle('engine:doctor', async () => engineManager.doctor())
  ipcMain.handle('engine:install-service', async () => engineManager.installService())
  ipcMain.handle('engine:upgrade', async (_event, packageName?: string) => {
    return engineManager.upgrade(packageName || 'mira-engine')
  })
  void engineManager.bootstrapLocalEngine().catch(() => {})
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
