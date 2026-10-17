import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamServerUserMenu } from './TeamServerUserMenu'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { useUiStore } from '@/stores/uiStore'
import type { MyUsage } from '@/services/teamUsage'

vi.mock('@/services/teamUsage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/teamUsage')>()
  return { ...actual, fetchMyUsage: vi.fn() }
})

const { fetchMyUsage } = await import('@/services/teamUsage')

const ORIGIN = 'https://mira.example.com'
const zero = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0, calls: 0, unreported_calls: 0 }

function usage(): MyUsage {
  return {
    user: 'alice', day: '2026-10-17', today: { ...zero, total_tokens: 1_700_000 }, month: { ...zero, total_tokens: 9_000_000 },
    by_model: [], warn_percent: 80,
    quota: {
      daily: { limit: 2_000_000, used: 1_700_000, remaining: 300_000, warn: true, exceeded: false,
        resets_at: '2026-10-18T00:00:00+08:00' },
      monthly: { limit: null, used: 9_000_000, remaining: null, warn: false, exceeded: false,
        resets_at: '2026-11-01T00:00:00+08:00' },
    },
  }
}

function signIn(roles: string[]) {
  useSettingsStore.setState({ language: 'en' })
  useSettingsStore.getState().setTeamServer(ORIGIN)
  useTeamServerStore.setState({ phase: 'signedIn', origin: ORIGIN, persistent: true,
    user: { name: 'alice', displayName: 'Alice', roles } })
}

describe('TeamServerUserMenu usage', () => {
  beforeEach(() => {
    vi.mocked(fetchMyUsage).mockReset().mockResolvedValue(usage())
    useUiStore.setState({ teamUsageOpen: false })
  })

  it('shows the user\'s own usage and quotas when opened', async () => {
    signIn(['user'])
    render(<TeamServerUserMenu />)
    expect(fetchMyUsage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mira Server account' }))
    const mine = await screen.findByLabelText('Your team-provider usage')
    expect(mine).toHaveTextContent('Today1.7M / 2M')
    expect(mine).toHaveTextContent('This month9M / unlimited')
    expect(fetchMyUsage).toHaveBeenCalledWith(ORIGIN)
    expect(screen.queryByRole('button', { name: 'Team usage & quotas' })).not.toBeInTheDocument()
  })

  it('lets administrators open the usage page; admin-only accounts have no usage of their own', async () => {
    signIn(['admin'])
    render(<TeamServerUserMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Mira Server account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Team usage & quotas' }))
    expect(useUiStore.getState().teamUsageOpen).toBe(true)
    expect(fetchMyUsage).not.toHaveBeenCalled()
  })
})
