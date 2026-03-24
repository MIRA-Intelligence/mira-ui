import { useSettingsStore } from '@/stores/settingsStore'
import type { TaskPlan } from '@/types'

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
