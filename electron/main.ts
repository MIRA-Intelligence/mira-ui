import { spawn } from 'child_process'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'

type UpgradeResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

function runEngineUpgrade(packageName: string): Promise<UpgradeResult> {
  const executable = process.platform === 'win32' ? 'medpilot-agent.exe' : 'medpilot-agent'
  const args = ['upgrade', '--package', packageName]

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      shell: process.platform === 'win32',
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, 120_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
      })
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

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
  ipcMain.handle('engine:upgrade', async (_event, packageName?: string) => {
    return runEngineUpgrade(packageName || 'medpilot-ai')
  })
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
