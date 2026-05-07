import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsModal, buildProviderOptions } from './SettingsModal'
import type { RuntimeProviderSettings } from '@/services/runtimeConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialUiState = useUiStore.getState()
const originalElectronApi = window.electronAPI

function resetStores() {
  useAgentStore.setState(initialAgentState, true)
  useProjectStore.setState(initialProjectState, true)
  useSettingsStore.setState(initialSettingsState, true)
  useUiStore.setState(initialUiState, true)
}

function getProviderSelect(): HTMLSelectElement {
  // The Label component renders unbound <label> text next to the <select>, so
  // there's no htmlFor association — read the first <select> in the local
  // runtime tab panel which is the Provider dropdown by construction.
  const tabPanel = screen.getByRole('tabpanel', { name: 'Local Engine' })
  const select = tabPanel.querySelector('select') as HTMLSelectElement | null
  if (!select) throw new Error('Provider select not found')
  return select
}

function clickLocalEngineTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Local Engine' }))
}

function fakeProvider(overrides: Partial<RuntimeProviderSettings> = {}): RuntimeProviderSettings {
  return {
    api_key_configured: false,
    api_key_preview: null,
    api_base: null,
    display_name: 'Provider',
    api_key_required: false,
    api_base_required: false,
    default_api_base: null,
    is_oauth: false,
    is_local: false,
    ...overrides,
  }
}

function fakeRuntimePayload(providers: Record<string, RuntimeProviderSettings>) {
  return {
    projects_root: '/tmp/projects',
    config_path: '/tmp/.mira/config.json',
    persisted: true,
    runtime: {
      workspace: '/tmp/projects',
      provider: 'auto',
      model: 'anthropic/claude-sonnet-4-5',
      reasoning_effort: null,
      max_tool_iterations: 200,
      restrict_to_workspace: false,
      setup_required: false,
      setup_message: null,
    },
    providers,
  }
}

function stubFetchWithRuntime(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/config')) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    }),
  )
}

describe('SettingsModal local engine configuration', () => {
  beforeEach(() => {
    resetStores()
    useSettingsStore.setState({
      language: 'en',
      deploymentMode: 'localBundle',
      apiUrl: 'http://127.0.0.1:18790/api',
      wsUrl: 'ws://127.0.0.1:18790/ws',
      settingsOpen: true,
    })
  })

  afterEach(() => {
    window.electronAPI = originalElectronApi
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the full provider list returned by /config so users can pick any of them', async () => {
    window.electronAPI = {
      platform: 'darwin',
      bootstrapLocalEngine: vi.fn().mockResolvedValue({
        phase: 'ready',
        message: 'Local engine is ready.',
        executablePath: '/tmp/mira-engine',
        healthUrl: 'http://127.0.0.1:18790/health',
        version: '0.2.0rc4',
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      }),
    }
    stubFetchWithRuntime(
      fakeRuntimePayload({
        auto: fakeProvider({ display_name: 'Auto-detect' }),
        anthropic: fakeProvider({ display_name: 'Anthropic', api_key_required: true }),
        openai: fakeProvider({ display_name: 'OpenAI', api_key_required: true }),
        deepseek: fakeProvider({ display_name: 'DeepSeek', api_key_required: true }),
        openai_codex: fakeProvider({ display_name: 'OpenAI Codex', is_oauth: true }),
        custom: fakeProvider({ display_name: 'Custom', api_base_required: true }),
      }),
    )

    render(<SettingsModal />)
    clickLocalEngineTab()

    await waitFor(() => {
      const optionValues = Array.from(getProviderSelect().options).map((o) => o.value)
      expect(optionValues).toEqual(expect.arrayContaining([
        'auto',
        'anthropic',
        'openai',
        'deepseek',
        'openai_codex',
        'custom',
      ]))
    })

    expect(Array.from(getProviderSelect().options).map((o) => o.value)[0]).toBe('auto')
  })

  it('shows the API Key field when the user picks a non-OAuth provider from the live list', async () => {
    window.electronAPI = {
      platform: 'darwin',
      bootstrapLocalEngine: vi.fn().mockResolvedValue({
        phase: 'ready',
        message: 'Local engine is ready.',
        executablePath: '/tmp/mira-engine',
        healthUrl: 'http://127.0.0.1:18790/health',
        version: '0.2.0rc4',
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      }),
    }
    stubFetchWithRuntime(
      fakeRuntimePayload({
        auto: fakeProvider({ display_name: 'Auto-detect' }),
        anthropic: fakeProvider({ display_name: 'Anthropic', api_key_required: true }),
      }),
    )

    render(<SettingsModal />)
    clickLocalEngineTab()

    await waitFor(() => {
      expect(Array.from(getProviderSelect().options).map((o) => o.value)).toContain('anthropic')
    })

    fireEvent.change(getProviderSelect(), { target: { value: 'anthropic' } })

    const tabPanel = screen.getByRole('tabpanel', { name: 'Local Engine' })
    await waitFor(() => {
      expect(within(tabPanel).getByText('API Key')).toBeInTheDocument()
    })

    const apiKeyLabel = within(tabPanel).getByText('API Key')
    const apiKeyInput = apiKeyLabel.nextElementSibling as HTMLInputElement
    expect(apiKeyInput).toBeInstanceOf(HTMLInputElement)
    expect(apiKeyInput.type).toBe('password')

    fireEvent.change(apiKeyInput, { target: { value: 'sk-ant-test-key' } })
    expect(apiKeyInput.value).toBe('sk-ant-test-key')
  })

  it('hides the API Key field for OAuth-managed providers', async () => {
    window.electronAPI = {
      platform: 'darwin',
      bootstrapLocalEngine: vi.fn().mockResolvedValue({
        phase: 'ready',
        message: 'Local engine is ready.',
        executablePath: '/tmp/mira-engine',
        healthUrl: 'http://127.0.0.1:18790/health',
        version: '0.2.0rc4',
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      }),
    }
    stubFetchWithRuntime(
      fakeRuntimePayload({
        auto: fakeProvider({ display_name: 'Auto-detect' }),
        openai_codex: fakeProvider({ display_name: 'OpenAI Codex', is_oauth: true }),
      }),
    )

    render(<SettingsModal />)
    clickLocalEngineTab()

    await waitFor(() => {
      expect(Array.from(getProviderSelect().options).map((o) => o.value)).toContain('openai_codex')
    })

    fireEvent.change(getProviderSelect(), { target: { value: 'openai_codex' } })

    const tabPanel = screen.getByRole('tabpanel', { name: 'Local Engine' })
    await waitFor(() => {
      expect(within(tabPanel).queryByText('API Key')).not.toBeInTheDocument()
      expect(within(tabPanel).getByText(/uses OAuth-managed credentials/i)).toBeInTheDocument()
    })
  })

  it('still loads /config when bootstrap reports a non-ready phase but the engine is reachable', async () => {
    window.electronAPI = {
      platform: 'darwin',
      bootstrapLocalEngine: vi.fn().mockResolvedValue({
        phase: 'starting',
        message: 'Waiting for local engine health check...',
        executablePath: '/tmp/mira-engine',
        healthUrl: 'http://127.0.0.1:18790/health',
        version: null,
        serviceInstalled: true,
        serviceRunning: true,
        lastCommand: null,
        error: null,
      }),
    }
    stubFetchWithRuntime({
      ...fakeRuntimePayload({
        custom: fakeProvider({
          display_name: 'Custom',
          api_base: 'http://127.0.0.1:9/v1',
          api_base_required: true,
        }),
        anthropic: fakeProvider({ display_name: 'Anthropic', api_key_required: true }),
      }),
      runtime: {
        workspace: '/tmp/projects',
        provider: 'custom',
        model: 'custom/mira-ui-bundle-setup',
        reasoning_effort: null,
        max_tool_iterations: 200,
        restrict_to_workspace: false,
        setup_required: true,
        setup_message: 'Custom provider API Base is empty.',
        setup_code: 'missing_api_base',
        setup_subject: 'Custom',
      },
    })

    render(<SettingsModal />)
    clickLocalEngineTab()

    await waitFor(() => {
      expect(getProviderSelect().value).toBe('custom')
    })

    const tabPanel = screen.getByRole('tabpanel', { name: 'Local Engine' })
    const apiBaseLabel = within(tabPanel).getByText('API Base')
    const apiBaseInput = apiBaseLabel.nextElementSibling as HTMLInputElement
    expect(apiBaseInput.value).toBe('http://127.0.0.1:9/v1')

    expect(Array.from(getProviderSelect().options).map((o) => o.value)).toEqual(
      expect.arrayContaining(['custom', 'anthropic']),
    )
  })

  it('reports a feedback error when both bootstrap and /config fail (engine truly unreachable)', async () => {
    window.electronAPI = {
      platform: 'darwin',
      bootstrapLocalEngine: vi.fn().mockResolvedValue({
        phase: 'error',
        message: 'Local engine service failed to start.',
        executablePath: null,
        healthUrl: 'http://127.0.0.1:18790/health',
        version: null,
        serviceInstalled: false,
        serviceRunning: false,
        lastCommand: null,
        error: 'start failed',
      }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    render(<SettingsModal />)
    clickLocalEngineTab()

    // Feedback surfaces the combined bootstrap + fetch error so the user can
    // act on it instead of the dropdown silently looking empty.
    await waitFor(() => {
      expect(screen.getByText(/Local engine service failed to start\./i)).toBeInTheDocument()
    })
  })
})

describe('buildProviderOptions ordering', () => {
  it('places auto first and sorts the rest alphabetically', () => {
    const options = buildProviderOptions(
      {
        zhipu: fakeProvider({ display_name: 'Zhipu AI' }),
        auto: fakeProvider({ display_name: 'Auto-detect' }),
        anthropic: fakeProvider({ display_name: 'Anthropic' }),
        openai: fakeProvider({ display_name: 'OpenAI' }),
      },
      'auto',
    )
    expect(options.map((o) => o.value)).toEqual(['auto', 'anthropic', 'openai', 'zhipu'])
  })

  it('prepends an unknown selected provider so the user can still see and confirm it', () => {
    const options = buildProviderOptions(
      {
        anthropic: fakeProvider({ display_name: 'Anthropic' }),
        auto: fakeProvider({ display_name: 'Auto-detect' }),
      },
      'experimental_new',
    )
    expect(options[0]).toEqual({ value: 'experimental_new', label: 'experimental_new' })
    expect(options.map((o) => o.value)).toContain('auto')
    expect(options.map((o) => o.value)).toContain('anthropic')
  })

  it('returns an empty list when the engine has not responded yet (no fallback)', () => {
    const options = buildProviderOptions({}, 'auto')
    // `auto` is the user's current selection and is not in the live providers
    // map, so it appears as a "placeholder" option per the existing rule.
    expect(options).toEqual([{ value: 'auto', label: 'auto' }])
  })
})
