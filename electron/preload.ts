import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

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
  repairLocalEngineService: () => ipcRenderer.invoke('engine:repair-service'),
  selectDataPath: (kind: 'file' | 'directory') => ipcRenderer.invoke('dialog:select-data-path', kind),
  selectDirectory: () => ipcRenderer.invoke('project:select-directory'),

  // App auto-update (v1: GitHub-release version-check + open release page).
  getAppVersion: () => ipcRenderer.invoke('update:get-app-version'),
  checkForUpdates: (opts?: { includePrereleases?: boolean; forceRefresh?: boolean }) =>
    ipcRenderer.invoke('update:check', opts),
  openReleasePage: (url: string) => ipcRenderer.invoke('update:open-release', url),
  skipUpdateVersion: (version: string) => ipcRenderer.invoke('update:skip-version', version),
  getSkippedUpdateVersions: () => ipcRenderer.invoke('update:get-skipped-versions'),
  resetSkippedUpdateVersions: () => ipcRenderer.invoke('update:reset-skipped-versions'),
  onUpdateAvailable: (
    listener: (info: {
      version: string
      tagName: string
      name: string
      url: string
      publishedAt: string
      isPrerelease: boolean
      notes: string
    }) => void,
  ) => {
    const wrapped = (_event: IpcRendererEvent, info: Parameters<typeof listener>[0]) => listener(info)
    ipcRenderer.on('update:available', wrapped)
    return () => ipcRenderer.removeListener('update:available', wrapped)
  },
})
