import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TeamServerUserMenu } from './TeamServerUserMenu'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { createMockMiraServer, type MockMiraServer } from '@/test/mockMiraServer'
import { installTeamServerBridge } from '@/test/teamServerBridge'
import { loginTeamServer, resetTeamServerAuthForTests, teamServerAccessToken } from '@/services/teamServer'

const ORIGIN = 'https://mira.example.com'

describe('TeamServerUserMenu', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()
  let server: MockMiraServer

  beforeEach(() => {
    resetTeamServerAuthForTests()
    useSettingsStore.setState({ ...initialSettings, language: 'en' }, true)
    useTeamServerStore.setState(initialTeam, true)
    useSettingsStore.getState().setTeamServer(ORIGIN)
    server = createMockMiraServer()
    installTeamServerBridge(server)
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('is hidden outside Team server mode', () => {
    useSettingsStore.getState().setDeploymentMode('localBundle')
    const { container } = render(<TeamServerUserMenu />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the user, admin role and server, and signs out', async () => {
    await loginTeamServer(ORIGIN, 'root', 'admin pass')
    useTeamServerStore.getState().setEngine({ state: 'running', version: '0.5.0', message: null })
    render(<TeamServerUserMenu />)
    const button = screen.getByRole('button', { name: 'Mira Server account' })
    expect(button).toHaveTextContent('Rita Root')
    expect(within(button).getByText('Admin')).toBeInTheDocument()
    expect(button).toHaveTextContent('mira.example.com')

    fireEvent.click(button)
    const menu = screen.getByRole('dialog', { name: 'Mira Server account' })
    expect(menu).toHaveTextContent('Running · 0.5.0')
    expect(menu).toHaveTextContent('mira.example.com')
    // Refresh tokens are kept in memory here (no keychain in tests).
    expect(menu).toHaveTextContent('sign in again the next time')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Signed out — Sign in/ })).toBeInTheDocument())
    expect(server.count('POST', '/server/auth/logout')).toBe(1)
    expect(server.revokedFamilies.size).toBe(1)
    expect(teamServerAccessToken(ORIGIN)).toBeNull()
    expect(useSettingsStore.getState()).toMatchObject({
      engineStatus: 'unreachable',
      connectionMessage: 'Signed out of mira.example.com. Sign in to continue.',
    })
  })

  it('shows a regular user without the admin badge', async () => {
    await loginTeamServer(ORIGIN, 'alice', 'correct horse')
    render(<TeamServerUserMenu />)
    const button = screen.getByRole('button', { name: 'Mira Server account' })
    expect(button).toHaveTextContent('Alice Liddell')
    expect(within(button).queryByText('Admin')).toBeNull()
  })

  it('offers Sign in when signed out instead of prompting', () => {
    useTeamServerStore.getState().setSignedOut(ORIGIN)
    render(<TeamServerUserMenu />)
    expect(useTeamServerStore.getState().login).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Signed out — Sign in/ }))
    expect(useTeamServerStore.getState().login).toEqual({ origin: ORIGIN, reason: 'manual' })
  })
})
