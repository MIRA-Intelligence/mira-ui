import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/runtimeConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/runtimeConfig')>()
  return {
    ...actual,
    fetchRuntimeConfig: vi.fn(),
    saveProvidersConfig: vi.fn(),
    fetchProviderModels: vi.fn(),
    testProvider: vi.fn(),
  }
})

import { ProvidersPage } from './ProvidersPage'
import {
  fetchProviderModels,
  fetchRuntimeConfig,
  saveProvidersConfig,
  testProvider,
  type RuntimeConfigPayload,
} from '@/services/runtimeConfig'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialUiState = useUiStore.getState()
const initialSettingsState = useSettingsStore.getState()

function payload(): RuntimeConfigPayload {
  const provider = (over: Partial<RuntimeConfigPayload['providers'][string]> = {}) => ({
    api_key_configured: false,
    api_key_preview: null,
    api_base: null,
    models: [],
    configured: false,
    enabled: false,
    display_name: 'X',
    api_key_required: true,
    api_base_required: false,
    default_api_base: null,
    is_oauth: false,
    is_local: false,
    ...over,
  })
  return {
    projects_root: '/p',
    config_path: '/p/config.json',
    persisted: false,
    runtime: {
      workspace: '/p',
      provider: 'deepseek',
      model: 'deepseek/deepseek-chat',
      reasoning_effort: null,
      temperature: 0.1,
      max_tool_iterations: 200,
      restrict_to_workspace: false,
      supervisor_provider: 'auto',
      supervisor_model: null,
      student_provider: 'auto',
      student_model: null,
      critic_provider: 'auto',
      critic_model: null,
    },
    providers: {
      auto: provider({ display_name: 'Auto-detect', api_key_required: false }),
      deepseek: provider({ display_name: 'DeepSeek', configured: true, enabled: true, api_key_configured: true, api_key_preview: 'sk...ek', models: ['deepseek/deepseek-chat'] }),
      openai: provider({ display_name: 'OpenAI' }),
    },
  }
}

describe('ProvidersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiStore.setState(initialUiState, true)
    useSettingsStore.setState(initialSettingsState, true)
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(payload())
    vi.mocked(saveProvidersConfig).mockResolvedValue(payload())
    vi.mocked(fetchProviderModels).mockResolvedValue({ provider: 'deepseek', api_base: null, models: ['deepseek/deepseek-reasoner'], cached: false })
    vi.mocked(testProvider).mockResolvedValue({ ok: true, message: 'ok', model_count: 2 })
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ProvidersPage />)
    expect(container).toBeEmptyDOMElement()
  })

  it('loads providers and groups them by enabled state', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await waitFor(() => expect(fetchRuntimeConfig).toHaveBeenCalled())
    // Both groups render their headers; DeepSeek (enabled) + OpenAI (disabled).
    expect(await screen.findByText(/Enabled \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Disabled \(1\)/)).toBeInTheDocument()
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0)
  })

  it('toggles a provider on and persists the enabled flag', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // Select the disabled OpenAI provider in the rail (its label also appears as
    // <option> elements in the role dropdowns, so target the rail button).
    const openaiRailButton = screen.getAllByText('OpenAI').find((el) => el.closest('button'))!
    fireEvent.click(openaiRailButton)
    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    expect(arg.providers?.openai?.enabled).toBe(true)
  })

  it('fetches models and adds them to the curated list', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    fireEvent.click(screen.getByText('Fetch from provider'))
    await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledWith('deepseek', { refresh: true, apiUrl: expect.any(String) }))
    expect(await screen.findByText('deepseek/deepseek-reasoner')).toBeInTheDocument()
  })

  it('saves provider and runtime updates', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls[0][0]
    expect(arg.runtime).toMatchObject({ provider: 'deepseek', model: 'deepseek/deepseek-chat' })
  })

  it('tests provider connectivity and reports the result', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(testProvider).toHaveBeenCalledWith('deepseek', expect.any(Object), expect.any(String)))
  })

  it('adds, sets-default, and removes a curated model, and binds a role provider', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // Add a model manually.
    const modelInput = screen.getByPlaceholderText('e.g. provider/model-name')
    fireEvent.change(modelInput, { target: { value: 'deepseek/extra' } })
    fireEvent.click(screen.getByText('Add'))
    expect(await screen.findByText('deepseek/extra')).toBeInTheDocument()

    // Promote it to the primary model, then remove the original.
    fireEvent.click(screen.getAllByText('Set as primary')[0])
    fireEvent.click(screen.getAllByText('Remove')[0])

    // Bind the first inheriting role (value "auto") to a concrete provider.
    const roleSelect = (screen.getAllByRole('combobox') as HTMLSelectElement[])
      .find((s) => s.value === 'auto')!
    fireEvent.change(roleSelect, { target: { value: 'openai' } })

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    expect(arg.runtime).toMatchObject({ supervisor_provider: 'openai' })
    expect(arg.providers?.deepseek?.models).toContain('deepseek/extra')
  })
})
