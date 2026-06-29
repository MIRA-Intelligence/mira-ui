import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/desktop', () => ({
  bootstrapLocalEngine: vi.fn(),
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
import { probeEngineCompatibility } from '@/services/engine'
import {
  fetchRuntimeConfig,
  updateProjectsRoot,
  type RuntimeConfigPayload,
} from '@/services/runtimeConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

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
})
