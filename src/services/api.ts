import { useSettingsStore } from '@/stores/settingsStore'
import type {
  AgentProfile,
  ContractVersion,
  LogEntry,
  SkillPlugin,
  SkillPluginScope,
  SkillPluginTargetType,
  TaskPlanContract,
  TaskPlan,
} from '@/types'

function getApiUrl(): string {
  return useSettingsStore.getState().apiUrl
}

export async function fetchPlan(sessionId?: string): Promise<TaskPlan | null> {
  try {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    const resp = await fetch(`${getApiUrl()}/plan${qs}`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data || data.error) return null
    return data as TaskPlan
  } catch {
    return null
  }
}

export async function fetchPlanContract(sessionId?: string): Promise<TaskPlanContract | null> {
  if (!sessionId) return null
  try {
    const qs = `?session_id=${encodeURIComponent(sessionId)}`
    const resp = await fetch(`${getApiUrl()}/plan/contract${qs}`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data || data.error) return null
    return data as TaskPlanContract
  } catch {
    return null
  }
}

export async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/status`)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

export interface RemoteProject {
  id: string
  display_name?: string
  title?: string
  status?: string
  core_question?: string
  started_at?: string
  run_mode?: 'manual' | 'auto'
  agent_profile?: AgentProfile
  contract_version?: ContractVersion
  has_plan: boolean
  has_meta?: boolean
}

export async function fetchProjects(): Promise<RemoteProject[]> {
  try {
    const resp = await fetch(`${getApiUrl()}/projects`)
    if (!resp.ok) return []
    const data = await resp.json()
    return (data?.projects as RemoteProject[]) ?? []
  } catch {
    return []
  }
}

export async function updateProjectDisplayName(sessionId: string, displayName: string): Promise<string> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/meta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  if (typeof data?.display_name === 'string' && data.display_name.trim().length > 0) {
    return data.display_name.trim()
  }
  return sessionId
}

export async function updateProjectRuntimePreferences(
  sessionId: string,
  payload: {
    runMode?: 'manual' | 'auto'
    agentProfile?: AgentProfile
    contractVersion?: ContractVersion
  },
): Promise<{ runMode?: 'manual' | 'auto'; agentProfile?: AgentProfile; contractVersion?: ContractVersion }> {
  const body: Record<string, unknown> = {}
  if (payload.runMode) body.run_mode = payload.runMode
  if (payload.agentProfile) body.agent_profile = payload.agentProfile
  if (payload.contractVersion) body.contract_version = payload.contractVersion
  if (Object.keys(body).length === 0) return {}

  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/meta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return {
    runMode: (data?.run_mode === 'manual' || data?.run_mode === 'auto') ? data.run_mode : undefined,
    agentProfile: (data?.agent_profile === 'engineer' || data?.agent_profile === 'default' || data?.agent_profile === 'research')
      ? data.agent_profile
      : undefined,
    contractVersion: (data?.contract_version === 1 || data?.contract_version === 2)
      ? data.contract_version
      : undefined,
  }
}

export async function fetchSessionHistory(sessionId: string): Promise<LogEntry[]> {
  try {
    const resp = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/history`)
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data?.entries) ? (data.entries as LogEntry[]) : []
  } catch {
    return []
  }
}

export async function deleteProjectFiles(sessionId: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${getApiUrl()}/projects?session_id=${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    )
    if (!resp.ok) return false
    const data = await resp.json()
    return !!data?.deleted
  } catch {
    return false
  }
}

export interface UploadedProjectFile {
  name: string
  path: string
  size: number
}

export interface DataPathValidationResult {
  ok: boolean
  error?: string
  kind?: 'file' | 'directory'
  resolved_path?: string
}

export async function uploadProjectFiles(sessionId: string, files: File[]): Promise<UploadedProjectFile[]> {
  if (files.length === 0) return []

  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file, file.name)
  }

  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/files`, {
    method: 'POST',
    body: formData,
  })
  if (!resp.ok) {
    let msg = ''
    try {
      const data = await resp.json()
      msg = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
    } catch {
      msg = await resp.text()
    }
    throw new Error(msg || `Failed to upload files for ${sessionId}`)
  }

  const data = await resp.json()
  return Array.isArray(data?.uploaded) ? data.uploaded as UploadedProjectFile[] : []
}

export async function validateDataPath(path: string): Promise<DataPathValidationResult> {
  const resp = await fetch(`${getApiUrl()}/data-path/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!resp.ok) {
    let msg = ''
    try {
      const data = await resp.json()
      msg = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
    } catch {
      msg = await resp.text()
    }
    return { ok: false, error: msg || 'validation request failed' }
  }
  const data = await resp.json()
  return {
    ok: !!data?.ok,
    error: typeof data?.error === 'string' ? data.error : undefined,
    kind: data?.kind === 'file' || data?.kind === 'directory' ? data.kind : undefined,
    resolved_path: typeof data?.resolved_path === 'string' ? data.resolved_path : undefined,
  }
}

export function getProjectArtifactUrl(sessionId: string, artifactPath: string): string {
  const sid = encodeURIComponent(sessionId)
  const path = encodeURIComponent(artifactPath)
  return `${getApiUrl()}/projects/${sid}/artifacts?path=${path}`
}

export async function fetchSkillPlugins(sessionId: string): Promise<SkillPlugin[]> {
  try {
    const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins`)
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
  } catch {
    return []
  }
}

export async function installSkillPluginFromDirectory(sessionId: string, path: string): Promise<SkillPlugin[]> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function installSkillPluginFromZip(sessionId: string, zipFile: File): Promise<SkillPlugin[]> {
  const formData = new FormData()
  formData.append('zip', zipFile, zipFile.name)
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/install`, {
    method: 'POST',
    body: formData,
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function setSkillPluginState(
  sessionId: string,
  payload: {
    scope: SkillPluginScope
    target_type: SkillPluginTargetType
    plugin_id: string
    enabled: boolean
    target_id?: string
  },
): Promise<SkillPlugin[]> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function uninstallSkillPlugin(sessionId: string, pluginId: string): Promise<SkillPlugin[]> {
  const resp = await fetch(
    `${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/${encodeURIComponent(pluginId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}
