import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  upgradeLocalEngine: (packageName = 'mira-engine') => ipcRenderer.invoke('engine:upgrade', packageName),
})
