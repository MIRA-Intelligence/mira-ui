import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/desktop', () => ({
  bootstrapLocalEngine: vi.fn(),
  hasDesktopEngineManager: vi.fn().mockReturnValue(false),
  getLocalEngineStatus: vi.fn().mockResolvedValue(null),
  restartLocalEngine: vi.fn(),
  doctorLocalEngine: vi.fn(),
  repairLocalEngineService: vi.fn(),
  startLocalEngine: vi.fn(),
  stopLocalEngine: vi.fn(),
  upgradeLocalEngine: vi.fn(),
}))

vi.mock('@/services/runtimeConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtimeConfig')>()
  return { ...actual, fetchRuntimeConfig: vi.fn().mockRejectedValue(new Error('offline')), updateProjectsRoot: vi.fn() }
})

import { SettingsModal } from './SettingsModal'
import { TeamServerLoginDialog } from './TeamServerLoginDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { createMockMiraServer, type MockMiraServer } from '@/test/mockMiraServer'
import { installTeamServerBridge } from '@/test/teamServerBridge'
import { resetTeamServerAuthForTests } from '@/services/teamServer'

const ORIGIN = 'https://mira.example.com'

describe('SettingsModal Team server', () => {
  const initialSettings = useSettingsStore.getState()
  const initialTeam = useTeamServerStore.getState()
  let server: MockMiraServer
  let entries: Map<string, string>

  beforeEach(() => {
    entries = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
      removeItem: (key: string) => { entries.delete(key) },
    })
    resetTeamServerAuthForTests()
    useSettingsStore.setState({ ...initialSettings, language: 'en', serverUsername: '' }, true)
    useSettingsStore.getState().setDeploymentMode('localBundle')
    useTeamServerStore.setState(initialTeam, true)
    server = createMockMiraServer()
    installTeamServerBridge(server)
    useSettingsStore.getState().openSettings()
  })

  afterEach(() => {
    useSettingsStore.getState().closeSettings()
    delete window.electronAPI
    vi.unstubAllGlobals()
  })

  function renderSettings() {
    render(<><SettingsModal /><TeamServerLoginDialog /></>)
    fireEvent.click(screen.getByRole('tab', { name: 'Team server' }))
    return screen.getByLabelText('Server URL')
  }

  it('offers a Team server mode with a server URL field', () => {
    const input = renderSettings()
    expect(screen.getByRole('tab', { name: 'Team server' })).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('placeholder', 'https://mira.example.com')
    expect(screen.getByText(/Signs in to a Mira Server/)).toBeInTheDocument()
  })

  it('requires https except for a server on this computer', async () => {
    const input = renderSettings()
    fireEvent.change(input, { target: { value: 'http://mira.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Use https:\/\//)).toBeInTheDocument()
    expect(server.requests).toHaveLength(0)
    expect(useSettingsStore.getState().deploymentMode).toBe('localBundle')
  })

  it('explains a URL that is not a Mira Server', async () => {
    server.state.product = 'nginx'
    const input = renderSettings()
    fireEvent.change(input, { target: { value: ORIGIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('https://mira.example.com is not a Mira Server. Check the address.')).toBeInTheDocument()
    expect(useTeamServerStore.getState().login).toBeNull()
  })

  it('checks the server, signs in and switches to it', async () => {
    const input = renderSettings()
    fireEvent.change(input, { target: { value: `${ORIGIN}/` } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign in to mira.example.com' })
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/server/info' })
    // Settings stays unchanged until sign-in succeeds.
    expect(useSettingsStore.getState().deploymentMode).toBe('localBundle')

    fireEvent.change(screen.getByLabelText('User name'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } })
    fireEvent.click(dialog.querySelector('button[type="submit"]')!)

    await waitFor(() => expect(useSettingsStore.getState().deploymentMode).toBe('teamServer'))
    expect(useSettingsStore.getState()).toMatchObject({ serverUrl: ORIGIN, apiUrl: `${ORIGIN}/api`, wsUrl: 'wss://mira.example.com/ws' })
    expect(await screen.findByText('Signed in to mira.example.com as Alice Liddell.')).toBeInTheDocument()
    const persisted = entries.get('mira-ui-settings') ?? ''
    expect(JSON.parse(persisted)).toMatchObject({ deploymentMode: 'teamServer', serverUrl: ORIGIN, serverUsername: 'alice' })
    expect(persisted).not.toMatch(/at-alice|rt-alice|correct horse/)

    // Sign out from Settings.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('Signed out of mira.example.com. Sign in to continue.', { selector: 'p' })).toBeInTheDocument()
    expect(server.count('POST', '/server/auth/logout')).toBe(1)
  })

  it('keeps the current mode when sign-in is cancelled', async () => {
    const input = renderSettings()
    fireEvent.change(input, { target: { value: ORIGIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign in to mira.example.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Sign in to/ })).toBeNull())
    expect(useSettingsStore.getState().deploymentMode).toBe('localBundle')
  })

  it('saves a new server without signing in', async () => {
    const input = renderSettings()
    fireEvent.change(input, { target: { value: ORIGIN } })
    // Opening Settings reads the (offline) local engine first.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(false))
    expect(useSettingsStore.getState()).toMatchObject({ deploymentMode: 'teamServer', serverUrl: ORIGIN })
    expect(server.count('POST', '/server/auth/login')).toBe(0)
  })
})
