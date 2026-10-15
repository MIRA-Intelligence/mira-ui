import { useSettingsStore } from '@/stores/settingsStore'

export interface JournalProfile {
  id: string
  name: string
  focus: string
  article_type: string
  homepage: string
  guidelines_url: string
  verification_status: 'verified' | 'needs_verification'
  checked_at: string
  profile_version: string
}

export async function fetchJournalProfiles(signal?: AbortSignal): Promise<JournalProfile[]> {
  const response = await fetch(`${useSettingsStore.getState().apiUrl}/workflow/v1/journals`, { signal })
  if (!response.ok) throw new Error('Journal catalog unavailable')
  const data = await response.json()
  if (!Array.isArray(data.journals) || !data.journals.every((item: JournalProfile) =>
    item && ['id', 'name', 'focus', 'article_type', 'homepage', 'guidelines_url', 'checked_at', 'profile_version']
      .every((key) => typeof item[key as keyof JournalProfile] === 'string')
    && ['verified', 'needs_verification'].includes(item.verification_status)
    && item.profile_version === data.profile_version
    && item.guidelines_url.startsWith('https://')
  )) throw new Error('Invalid journal catalog')
  return data.journals
}

export function journalSelection(profile: JournalProfile | null): Record<string, string> {
  return profile ? { target_journal: profile.id, journal_profile_version: profile.profile_version } : {}
}
