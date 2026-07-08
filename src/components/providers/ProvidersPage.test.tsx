import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      auto_max_rounds: 100,
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

  it('fetches models into a side panel and adds one to the curated list', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    fireEvent.click(screen.getByText('Fetch from provider'))
    await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledWith('deepseek', { refresh: true, apiUrl: expect.any(String) }))
    // Result shows in the side panel rather than being merged into the curated list.
    expect(await screen.findByText('Available models')).toBeInTheDocument()
    const panelRow = (await screen.findByText('deepseek/deepseek-reasoner')).closest('li')!
    fireEvent.click(within(panelRow).getByText('Add'))
    // Now it is a curated entry (gains the "Set as primary" action).
    await waitFor(() => {
      const curated = screen.getAllByText('deepseek/deepseek-reasoner').map((el) => el.closest('li')!)
      expect(curated.some((li) => within(li).queryByText('Set as primary'))).toBe(true)
    })
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

  it('adds a model-parameter rule and persists it on save', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // Open the global Model Parameters view from the left rail.
    fireEvent.click(screen.getByText('Model Parameters'))
    expect(await screen.findByText('Model Parameter Rules')).toBeInTheDocument()

    // Add a rule, set the pattern + a forced numeric parameter.
    fireEvent.click(screen.getByText('+ Add rule'))
    fireEvent.change(screen.getByPlaceholderText('e.g. */gpt-5* or kimi-k2.5'), {
      target: { value: '*nemotron*' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. temperature'), {
      target: { value: 'temperature' },
    })
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: '1' } })

    // Echo the saved rules back like a current engine does, so the editor keeps
    // showing them after save.
    vi.mocked(saveProvidersConfig).mockResolvedValueOnce({
      ...payload(),
      model_params: [{ pattern: '*nemotron*', params: { temperature: 1 } }],
    })

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    expect(arg.model_params).toEqual([{ pattern: '*nemotron*', params: { temperature: 1 } }])
    // The rule remains visible after a successful save.
    expect(await screen.findByDisplayValue('*nemotron*')).toBeInTheDocument()
  })

  it('supports a drop rule that omits a parameter', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue({
      ...payload(),
      model_params: [{ pattern: '*o1*', params: { temperature: null } }],
    })
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    fireEvent.click(screen.getByText('Model Parameters'))
    // The existing drop rule round-trips into the editor.
    expect(await screen.findByDisplayValue('*o1*')).toBeInTheDocument()
    expect(screen.getByText('Parameter will be omitted from the request.')).toBeInTheDocument()
  })

  it('edits agent runtime knobs and persists them on save', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // Open the Runtime view from the left rail.
    fireEvent.click(screen.getByText('Runtime'))
    expect(await screen.findByText('Agent Runtime')).toBeInTheDocument()

    // Max tool iterations is seeded from the loaded config (200); change it.
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '150' } })
    // Auto-mode max rounds is seeded from the loaded config (100); change it.
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '50' } })
    // Flip the workspace-restriction switch on.
    fireEvent.click(screen.getByRole('switch', { name: 'Restrict tool access to workspace' }))

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    expect(arg.runtime).toMatchObject({
      max_tool_iterations: 150,
      auto_max_rounds: 50,
      restrict_to_workspace: true,
      reasoning_effort: null,
    })
    // Temperature is no longer part of the runtime view.
    expect(arg.runtime).not.toHaveProperty('temperature')
  })

  it('assigns a curated model to a role via the split-button dropdown', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // Open the dropdown next to the curated model and pick a non-primary role.
    fireEvent.click(screen.getAllByLabelText('Assign to role')[0])
    fireEvent.click(screen.getByText('Set as Supervisor'))

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    expect(arg.runtime).toMatchObject({
      supervisor_provider: 'deepseek',
      supervisor_model: 'deepseek/deepseek-chat',
    })
  })
})
