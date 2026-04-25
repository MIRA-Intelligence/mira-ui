import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  bootstrapLocalEngine: () => ipcRenderer.invoke('engine:bootstrap'),
  getBootstrapState: () => ipcRenderer.invoke('engine:bootstrap-state'),
  getLocalEngineStatus: () => ipcRenderer.invoke('engine:status'),
  installLocalEngineService: () => ipcRenderer.invoke('engine:install-service'),
  startLocalEngine: () => ipcRenderer.invoke('engine:start'),
  stopLocalEngine: () => ipcRenderer.invoke('engine:stop'),
  doctorLocalEngine: () => ipcRenderer.invoke('engine:doctor'),
  upgradeLocalEngine: (packageName = 'mira-engine') => ipcRenderer.invoke('engine:upgrade', packageName),
})
