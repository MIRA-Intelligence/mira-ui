import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TeamAdminBanner } from './TeamAdminBanner'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'

const ORIGIN = 'https://mira.example.com'

describe('TeamAdminBanner', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()

  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettings, language: 'en' }, true)
    useSettingsStore.getState().setTeamServer(ORIGIN)
    useTeamServerStore.setState(initialTeam, true)
  })

  it('is hidden for users', () => {
    useTeamServerStore.getState().setSignedIn(ORIGIN, { name: 'alice', displayName: 'Alice', roles: ['user'] }, true)
    const { container } = render(<TeamAdminBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('tells administrators that their changes apply to everyone', () => {
    useTeamServerStore.getState().setSignedIn(ORIGIN, { name: 'root', displayName: 'Root', roles: ['user', 'admin'] }, true)
    render(<TeamAdminBanner />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Managing the Team Server (mira.example.com): changes in Settings and Providers apply to all users.')
    expect(screen.queryByText(/no workspace/)).not.toBeInTheDocument()
  })

  it('also says when the account has no workspace', () => {
    useTeamServerStore.getState().setSignedIn(ORIGIN, { name: 'dana', displayName: 'Dana', roles: ['admin'] }, true)
    render(<TeamAdminBanner />)
    expect(screen.getByText('This account has no workspace of its own.')).toBeInTheDocument()
  })

  it('is hidden outside Team server mode', () => {
    useTeamServerStore.getState().setSignedIn(ORIGIN, { name: 'root', displayName: 'Root', roles: ['admin'] }, true)
    useSettingsStore.setState({ deploymentMode: 'remoteSsh' })
    const { container } = render(<TeamAdminBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
