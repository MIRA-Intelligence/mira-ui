import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  upgradeLocalEngine: (packageName = 'medpilot') => ipcRenderer.invoke('engine:upgrade', packageName),
})
