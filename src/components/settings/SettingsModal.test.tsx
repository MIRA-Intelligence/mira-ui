import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/services/engine', () => ({
  probeEngineCompatibility: vi.fn(),
}))

vi.mock('@/services/runtimeConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtimeConfig')>()
  return {
    ...actual,
    fetchRuntimeConfig: vi.fn(),
    saveRuntimeConfig: vi.fn(),
    updateProjectsRoot: vi.fn(),
  }
})

import { SettingsModal } from './SettingsModal'
import { bootstrapLocalEngine } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import {
  fetchRuntimeConfig,
  updateProjectsRoot,
  type RuntimeConfigPayload,
} from '@/services/runtimeConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRemoteSshStore } from '@/stores/remoteSshStore'
import { IDLE_REMOTE_SSH_STATUS } from '@/services/remoteSsh'

const initialSettingsState = useSettingsStore.getState()
const initialProjectState = useProjectStore.getState()
const initialAgentState = useAgentStore.getState()

function runtimePayload(workspace: string, configPath = `${workspace}/config.json`): RuntimeConfigPayload {
  return {
    projects_root: workspace,
    config_path: configPath,
    persisted: true,
    runtime: {
      workspace,
      workspace_resolved: workspace,
      provider: 'custom',
      model: 'custom/test',
      reasoning_effort: null,
      temperature: 0.1,
      max_tool_iterations: 200,
      auto_max_rounds: 100,
      restrict_to_workspace: false,
    },
    providers: {},
  }
}

function openRemoteSettings(apiUrl: string, wsUrl: string, workspace: string) {
  const store = useSettingsStore.getState()
  store.setDeploymentMode('remoteManual')
  store.setConnectionEndpoints(apiUrl, wsUrl)
  store.setRuntimeConfig(runtimePayload(workspace))
  store.openSettings()
}

describe('SettingsModal remote runtime config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem?.('mira-ui-settings')
    localStorage.removeItem?.('medpilot-ui-settings')
    useSettingsStore.setState(initialSettingsState, true)
    useProjectStore.setState(initialProjectState, true)
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState({
      loadProjects: vi.fn().mockResolvedValue(undefined),
      resetWorkspaceState: vi.fn(),
    })
    useAgentStore.setState({
      resetWorkspaceState: vi.fn(),
    })
    vi.mocked(probeEngineCompatibility).mockResolvedValue({
      status: 'compatible',
      message: 'Engine is compatible.',
      version: '0.3.0',
      uptimeSeconds: null,
    })
  })

  it('does not restart a stopped local engine when opening or saving settings', async () => {
    vi.mocked(fetchRuntimeConfig).mockRejectedValue(new Error('engine offline'))
    useSettingsStore.setState({ deploymentMode: 'localBundle', localEnginePhase: 'idle', settingsOpen: true })
    render(<SettingsModal />)
    await screen.findByText('engine offline')
    expect(bootstrapLocalEngine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchRuntimeConfig).toHaveBeenCalledTimes(2))
    expect(bootstrapLocalEngine).not.toHaveBeenCalled()
  })

  it('reads workspace from a changed remote endpoint without posting the old workspace', async () => {
    vi.mocked(fetchRuntimeConfig).mockImplementation(async (apiUrl) => {
      if (apiUrl === 'https://new.example/api') {
        return runtimePayload('/new/workspace', '/new/config.json')
      }
      return runtimePayload('/old/workspace', '/old/config.json')
    })
    vi.mocked(updateProjectsRoot).mockResolvedValue(runtimePayload('/should/not/write'))

    openRemoteSettings('https://old.example/api', 'wss://old.example/ws', '/old/workspace')
    render(<SettingsModal />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByDisplayValue('https://old.example/api'), {
      target: { value: 'https://new.example/api' },
    })
    fireEvent.change(screen.getByDisplayValue('wss://old.example/ws'), {
      target: { value: 'wss://new.example/ws' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(fetchRuntimeConfig).toHaveBeenCalledWith('https://new.example/api')
    })

    expect(updateProjectsRoot).not.toHaveBeenCalled()
    await waitFor(() => {
      const state = useSettingsStore.getState()
      expect(state.apiUrl).toBe('https://new.example/api')
      expect(state.wsUrl).toBe('wss://new.example/ws')
      expect(state.workspacePath).toBe('/new/workspace')
    })
  })

  it('no longer shows a separate Local Engine tab and exposes a Manage providers entry', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(runtimePayload('/old/workspace', '/old/config.json'))

    openRemoteSettings('https://old.example/api', 'wss://old.example/ws', '/old/workspace')
    render(<SettingsModal />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })

    // The two-tab structure (with a "Local Engine" tab) is gone.
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('Local Engine')).toBeNull()
    // Provider/runtime config is reachable via the Providers page entry point.
    expect(screen.getAllByText('Manage providers').length).toBeGreaterThan(0)
  })

  it('updates the engine workspace only when the workspace field was edited', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(runtimePayload('/old/workspace', '/old/config.json'))
    vi.mocked(updateProjectsRoot).mockImplementation(async (workspace) => (
      runtimePayload(workspace, '/old/config.json')
    ))

    openRemoteSettings('https://old.example/api', 'wss://old.example/ws', '/old/workspace')
    render(<SettingsModal />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByDisplayValue('/old/workspace'), {
      target: { value: '/changed/workspace' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateProjectsRoot).toHaveBeenCalledWith('/changed/workspace', 'https://old.example/api')
    })
    await waitFor(() => {
      expect(useSettingsStore.getState().workspacePath).toBe('/changed/workspace')
    })
  })

  it('warns when a remote engine is reached over plaintext http/ws', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(runtimePayload('/old/workspace', '/old/config.json'))

    openRemoteSettings('http://10.0.0.5:18790/api', 'ws://10.0.0.5:18790/ws', '/old/workspace')
    render(<SettingsModal />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unencrypted connection')
    expect(alert).toHaveTextContent('ssh -N -L 18791:127.0.0.1:18790 <user>@10.0.0.5')
    expect(alert).toHaveTextContent('http://127.0.0.1:18791/api')
  })

  it('does not warn for TLS endpoints or loopback tunnels', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(runtimePayload('/old/workspace', '/old/config.json'))

    openRemoteSettings('https://old.example/api', 'wss://old.example/ws', '/old/workspace')
    render(<SettingsModal />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.change(screen.getByDisplayValue('https://old.example/api'), {
      target: { value: 'http://127.0.0.1:18791/api' },
    })
    fireEvent.change(screen.getByDisplayValue('wss://old.example/ws'), {
      target: { value: 'ws://127.0.0.1:18791/ws' },
    })
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.change(screen.getByDisplayValue('ws://127.0.0.1:18791/ws'), {
      target: { value: 'ws://server.lab.example:18790/ws' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('<user>@server.lab.example')
  })

  describe('Remote server (SSH)', () => {
    beforeEach(() => {
      useRemoteSshStore.setState({ status: IDLE_REMOTE_SSH_STATUS })
      window.electronAPI = {
        platform: 'darwin',
        remoteSshConnect: vi.fn(async (host: string) => ({ phase: 'connecting' as const, host, localPort: null, version: null, error: null, attempt: 0 })),
        remoteSshDisconnect: vi.fn(async () => IDLE_REMOTE_SSH_STATUS),
        listSshHosts: vi.fn(async () => ['lab', 'gpu02']),
      }
    })
    afterEach(() => { delete window.electronAPI })

    it('switches to an SSH host from ~/.ssh/config without asking for URLs or tokens', async () => {
      vi.mocked(fetchRuntimeConfig).mockResolvedValue(runtimePayload('/old/workspace', '/old/config.json'))
      openRemoteSettings('https://old.example/api', 'wss://old.example/ws', '/old/workspace')
      const { container } = render(<SettingsModal />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled())

      fireEvent.click(screen.getByRole('radio', { name: 'Remote server (SSH)' }))
      expect(screen.queryByText('API URL')).toBeNull()
      expect(screen.queryByText('Engine token')).toBeNull()
      await waitFor(() => expect(container.querySelectorAll('#mira-ssh-hosts option')).toHaveLength(2))

      fireEvent.change(screen.getByPlaceholderText('Alias from ~/.ssh/config, or user@host[:port]'), { target: { value: 'lab' } })
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

      const state = useSettingsStore.getState()
      expect(state.deploymentMode).toBe('remoteSsh')
      expect(state.sshHost).toBe('lab')
      expect(state.activeEngineKey).toBe('ssh:lab')
    })

    it('shows connection status and errors for the active host', async () => {
      useSettingsStore.getState().setDeploymentMode('remoteSsh')
      useSettingsStore.getState().setSshHost('lab')
      useRemoteSshStore.setState({ status: {
        phase: 'error', host: 'lab', localPort: null, version: null, attempt: 0,
        error: { code: 'not_installed', message: 'sh: 1: mira: not found' },
      } })
      useSettingsStore.getState().openSettings()
      render(<SettingsModal />)

      expect(await screen.findByRole('status')).toHaveTextContent('Could not run `mira` on lab')
      expect(fetchRuntimeConfig).not.toHaveBeenCalled()

      // Point the host at a mira outside the login-shell PATH and retry.
      fireEvent.change(screen.getByPlaceholderText('mira'), { target: { value: '/opt/mira/bin/mira' } })
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
      await waitFor(() => expect(window.electronAPI?.remoteSshConnect).toHaveBeenCalledWith('lab', '/opt/mira/bin/mira'))
      expect(useSettingsStore.getState().engineProfiles['ssh:lab'].sshMiraCommand).toBe('/opt/mira/bin/mira')
      expect(await screen.findByRole('status')).toHaveTextContent('Connecting to lab over SSH')

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
      expect(window.electronAPI?.remoteSshDisconnect).toHaveBeenCalled()
    })

    it('requires a host to save', async () => {
      useSettingsStore.getState().setDeploymentMode('remoteSsh')
      useSettingsStore.getState().setSshHost('')
      useSettingsStore.getState().openSettings()
      render(<SettingsModal />)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByText('Enter an SSH host in Settings → Connection.')).toBeInTheDocument()
      expect(useSettingsStore.getState().settingsOpen).toBe(true)
    })
  })
})
