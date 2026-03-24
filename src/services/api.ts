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
