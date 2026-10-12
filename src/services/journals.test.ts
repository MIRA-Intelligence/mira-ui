import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJournalProfiles, journalSelection } from './journals'
import { useSettingsStore } from '@/stores/settingsStore'
import { journalFixture } from '@/test/journalFixtures'

afterEach(() => vi.unstubAllGlobals())

describe('journal catalog API', () => {
  it('reads the engine-owned catalog and encodes only ID and version', async () => {
    useSettingsStore.setState({ apiUrl: 'http://test/api' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile_version: journalFixture.profile_version, journals: [journalFixture] })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchJournalProfiles()).toEqual([journalFixture])
    expect(fetchMock).toHaveBeenCalledWith('http://test/api/workflow/v1/journals', { signal: undefined })
    expect(journalSelection(journalFixture)).toEqual({ target_journal: 'mrm', journal_profile_version: '2026-10-12' })
    expect(journalSelection(null)).toEqual({})
  })

  it('rejects malformed catalogs and non-HTTPS links', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      profile_version: journalFixture.profile_version,
      journals: [{ ...journalFixture, guidelines_url: 'javascript:alert(1)' }],
    }))))
    await expect(fetchJournalProfiles()).rejects.toThrow('Invalid journal catalog')
  })
})
