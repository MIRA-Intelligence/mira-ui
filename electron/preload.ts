import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  upgradeLocalEngine: (packageName = 'medpilot-ai') => ipcRenderer.invoke('engine:upgrade', packageName),
})
