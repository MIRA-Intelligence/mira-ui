import { useSettingsStore } from '@/stores/settingsStore'
import type { LogEntry, TaskPlan } from '@/types'

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
  title?: string
  status?: string
  core_question?: string
  started_at?: string
  has_plan: boolean
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

export function getProjectArtifactUrl(sessionId: string, artifactPath: string): string {
  const sid = encodeURIComponent(sessionId)
  const path = encodeURIComponent(artifactPath)
  return `${getApiUrl()}/projects/${sid}/artifacts?path=${path}`
}
