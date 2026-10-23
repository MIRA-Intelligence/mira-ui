import { useSettingsStore } from '@/stores/settingsStore'

export interface UserProfile {
  name: string
  timezone: string
  languages: string
}

export interface AgentProfile {
  name: string
  identity: string
}

export interface ProfileState {
  needs_onboarding: boolean
  user: UserProfile
  agent: AgentProfile
}

export interface SaveProfilePayload {
  user: Partial<UserProfile>
  agent: Partial<AgentProfile>
}

function resolveApiUrl(apiUrl?: string): string {
  return apiUrl ?? useSettingsStore.getState().apiUrl
}

export async function getProfileState(apiUrl?: string): Promise<ProfileState> {
  const resp = await fetch(`${resolveApiUrl(apiUrl)}/profile`)
  if (!resp.ok) {
    throw new Error((await resp.text()) || 'Failed to fetch profile')
  }
  return (await resp.json()) as ProfileState
}

export async function saveProfile(
  payload: SaveProfilePayload,
  apiUrl?: string,
): Promise<{ ok: boolean }> {
  const resp = await fetch(`${resolveApiUrl(apiUrl)}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    let message = ''
    try {
      const data = await resp.json()
      message = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
    } catch {
      message = await resp.text()
    }
    throw new Error(message || 'Failed to save profile')
  }
  return (await resp.json()) as { ok: boolean }
}
