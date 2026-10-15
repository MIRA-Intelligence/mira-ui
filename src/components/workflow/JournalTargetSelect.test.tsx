import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JournalTargetSelect } from './JournalTargetSelect'
import { fetchJournalProfiles, type JournalProfile } from '@/services/journals'
import { useSettingsStore } from '@/stores/settingsStore'
import { journalFixture } from '@/test/journalFixtures'

vi.mock('@/services/journals', async (original) => ({ ...await original<typeof import('@/services/journals')>(), fetchJournalProfiles: vi.fn() }))

function Harness() {
  const [profile, setProfile] = useState<JournalProfile | null>(null)
  return <JournalTargetSelect value={profile} onChange={setProfile} />
}

describe('JournalTargetSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSettingsStore.setState({ language: 'en', apiUrl: 'http://test/api' })
    vi.mocked(fetchJournalProfiles).mockResolvedValue([journalFixture])
  })

  it('defaults to generic and shows the chosen journal source and scope', async () => {
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    expect(screen.getByRole('combobox')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Target journal'), { target: { value: 'mrm' } })
    expect(screen.getByText(/MR methodology/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Official author guide' })).toHaveAttribute('href', journalFixture.guidelines_url)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('clearly marks unverified journal requirements', async () => {
    vi.mocked(fetchJournalProfiles).mockResolvedValue([{ ...journalFixture, verification_status: 'needs_verification' }])
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mrm' } })
    expect(screen.getByRole('alert')).toHaveTextContent('not fully verified')
  })

  it('keeps generic available on old engines and supports retry', async () => {
    vi.mocked(fetchJournalProfiles).mockRejectedValueOnce(new Error('404'))
    render(<Harness />)
    await screen.findByRole('alert')
    expect(screen.getByRole('combobox')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('option', { name: journalFixture.name })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the previous engine selection and ignores its late response', async () => {
    let resolve!: (profiles: JournalProfile[]) => void
    vi.mocked(fetchJournalProfiles).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    render(<Harness />)
    act(() => useSettingsStore.setState({ apiUrl: 'http://other/api' }))
    await screen.findByRole('option', { name: journalFixture.name })
    await act(async () => resolve([{ ...journalFixture, id: 'obsolete', name: 'Obsolete' }]))
    expect(screen.queryByRole('option', { name: 'Obsolete' })).not.toBeInTheDocument()
  })
})
