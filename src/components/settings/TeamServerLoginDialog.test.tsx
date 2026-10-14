import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamServerLoginDialog } from './TeamServerLoginDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { requestTeamServerLogin, useTeamServerStore } from '@/stores/teamServerStore'
import { createMockMiraServer, type MockMiraServer } from '@/test/mockMiraServer'
import { installTeamServerBridge } from '@/test/teamServerBridge'
import { resetTeamServerAuthForTests, teamServerAccessToken } from '@/services/teamServer'

const ORIGIN = 'https://mira.example.com'

describe('TeamServerLoginDialog', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()
  let server: MockMiraServer

  beforeEach(() => {
    resetTeamServerAuthForTests()
    useSettingsStore.setState({ ...initialSettings, serverUsername: '', language: 'en' }, true)
    useTeamServerStore.setState(initialTeam, true)
    server = createMockMiraServer()
    installTeamServerBridge(server)
  })

  afterEach(() => {
    delete window.electronAPI
  })

  function open(reason: 'settings' | 'expired' = 'settings') {
    let result!: Promise<boolean>
    act(() => { result = requestTeamServerLogin(ORIGIN, reason) })
    return result
  }

  function fill(username: string, password: string) {
    fireEvent.change(screen.getByLabelText('User name'), { target: { value: username } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('renders above Settings, portalled to the document body', () => {
    const { container } = render(<TeamServerLoginDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
    void open()
    const dialog = screen.getByRole('dialog', { name: 'Sign in to mira.example.com' })
    expect(dialog.className).toContain('z-[1500]')
    expect(dialog.parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('signs in, remembers the user name only and resolves the request', async () => {
    render(<TeamServerLoginDialog />)
    const result = open()
    fill('alice', 'correct horse')
    await expect(result).resolves.toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.requests[0]).toMatchObject({ path: '/server/auth/login', body: { username: 'alice', client: 'desktop' } })
    expect(useSettingsStore.getState().serverUsername).toBe('alice')
    expect(useTeamServerStore.getState()).toMatchObject({ phase: 'signedIn', origin: ORIGIN, user: { name: 'alice' } })
    expect(teamServerAccessToken(ORIGIN)).toMatch(/^at-alice/)
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain('correct horse')
  })

  it.each([
    ['alice', 'wrong', 'Wrong user name or password.'],
    ['mallory', 'pw', 'mira-users'],
  ])('shows why %s could not sign in and clears the password', async (username, password, message) => {
    render(<TeamServerLoginDialog />)
    void open()
    fill(username, password)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useTeamServerStore.getState().phase).not.toBe('signedIn')
  })

  it('explains rate limiting and network failures', async () => {
    render(<TeamServerLoginDialog />)
    void open()
    server.state.rateLimited = true
    fill('alice', 'correct horse')
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 30 s')
    server.state.networkError = new TypeError('fetch failed')
    fill('alice', 'correct horse')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reach mira.example.com'))
  })

  it('shows progress while signing in', async () => {
    render(<TeamServerLoginDialog />)
    void open()
    let release!: () => void
    const original = window.electronAPI!.teamServerLogin!
    window.electronAPI!.teamServerLogin = vi.fn(async (...args: [string, string, string]) => {
      await new Promise<void>((resolve) => { release = resolve })
      return original(...args)
    })
    fill('alice', 'correct horse')
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('User name')).toBeDisabled()
    await act(async () => { release() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancels with the button or Escape', async () => {
    render(<TeamServerLoginDialog />)
    const first = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(first).resolves.toBe(false)
    const second = open('expired')
    expect(screen.getByText('Your session has ended. Sign in again to continue.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await expect(second).resolves.toBe(false)
    expect(server.requests).toHaveLength(0)
  })

  it('prefills the last user name', () => {
    useSettingsStore.setState({ serverUsername: 'alice' })
    render(<TeamServerLoginDialog />)
    void open()
    expect(screen.getByLabelText('User name')).toHaveValue('alice')
  })
})
