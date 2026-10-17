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

  it('shows a team-managed provider read-only and never saves it', async () => {
    const team = payload()
    team.providers.deepseek = { ...team.providers.deepseek, managed_by: 'team', api_key_preview: null, api_base: 'http://127.0.0.1:8740/llm/deepseek' }
    team.team = { revision: 'r1', providers: ['deepseek'], model_params: false, defaults: [] }
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(team)
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    expect(await screen.findByText(/Your Team Server administrators manage DeepSeek/)).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()  // rail badge
    expect(screen.queryByText('Fetch from provider')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/key/i)).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()
    // Testing goes through the engine (and Mira Server's LLM proxy): still allowed.
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(testProvider).toHaveBeenCalledWith('deepseek', expect.any(Object), expect.any(String)))

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    expect(vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0].providers).not.toHaveProperty('deepseek')
  })

  it('shows team model-parameter rules read-only and does not send them', async () => {
    const team = payload()
    team.model_params = [{ pattern: 'gpt-5*', params: { temperature: null } }]
    team.team = { revision: 'r1', providers: [], model_params: true, defaults: [] }
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(team)
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    fireEvent.click(screen.getAllByText('Model Parameters')[0])
    expect(await screen.findByText(/set these rules; they cannot be changed here/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    expect(vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]).not.toHaveProperty('model_params')
  })

  it('marks the team settings when an administrator edits them', async () => {
    vi.mocked(fetchRuntimeConfig).mockResolvedValue({ ...payload(), scope: 'team' })
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    expect(await screen.findByText(/Team settings · Changes here apply to every user/)).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ProvidersPage />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the header out of the Electron drag region so Save/Close stay clickable', async () => {
    window.electronAPI = { platform: 'darwin' } as typeof window.electronAPI
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    const header = (await screen.findByRole('button', { name: 'Cancel' })).closest('[data-drag-region]')
    expect(header).toHaveAttribute('data-drag-region', 'no-drag')
    expect(header).toHaveClass('pl-24')
    window.electronAPI = undefined as unknown as typeof window.electronAPI
  })

  it('loads providers and groups them by enabled state', async () => {
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await waitFor(() => expect(fetchRuntimeConfig).toHaveBeenCalled())
    // DeepSeek (enabled) + OpenAI (not enabled, pay-as-you-go).
    expect(await screen.findByText(/Enabled \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Pay-as-you-go \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Subscription plans \(/)).not.toBeInTheDocument()
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0)
  })

  it('splits providers that are not enabled into subscription and pay-as-you-go groups', async () => {
    const data = payload()
    data.providers.kimi_code = { ...data.providers.openai, display_name: 'Kimi Code', is_subscription: true }
    data.providers.openai_codex = { ...data.providers.openai, display_name: 'OpenAI Codex', is_subscription: true, is_oauth: true, enabled: true, configured: true }
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(data)
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)

    const enabledHeader = await screen.findByText(/Enabled \(2\)/)
    const subscriptionHeader = screen.getByRole('button', { name: /Subscription plans \(1\)/ })
    const paygHeader = screen.getByRole('button', { name: /Pay-as-you-go \(1\)/ })
    // Enabled first, then subscription plans above pay-as-you-go.
    expect(enabledHeader.compareDocumentPosition(subscriptionHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(subscriptionHeader.compareDocumentPosition(paygHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const railButton = (label: string) => screen.queryAllByText(label).find((el) => el.closest('button') && !el.closest('select'))
    expect(railButton('Kimi Code')).toBeDefined()

    // Collapsing a group hides its entries; searching shows them again.
    fireEvent.click(subscriptionHeader)
    expect(subscriptionHeader).toHaveAttribute('aria-expanded', 'false')
    expect(railButton('Kimi Code')).toBeUndefined()
    fireEvent.change(screen.getByPlaceholderText('Search providers...'), { target: { value: 'kimi' } })
    expect(railButton('Kimi Code')).toBeDefined()
  })

  it('warns about the GLM Coding Plan usage terms on its provider page', async () => {
    const data = payload()
    data.providers.zhipu_coding_plan = { ...data.providers.openai, display_name: 'GLM Coding Plan', is_subscription: true }
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(data)
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')
    // DeepSeek (no usage terms) is selected first.
    expect(screen.queryByRole('note')).not.toBeInTheDocument()

    const railButton = screen.getAllByText('GLM Coding Plan').find((el) => el.closest('button') && !el.closest('select'))!
    fireEvent.click(railButton)
    expect(await screen.findByRole('note')).toHaveTextContent(/Mira is not on that list/)
  })

  it('groups subscription providers first in the provider dropdowns', async () => {
    const data = payload()
    data.providers.kimi_code = { ...data.providers.openai, display_name: 'Kimi Code', is_subscription: true }
    vi.mocked(fetchRuntimeConfig).mockResolvedValue(data)
    useUiStore.getState().openProviders()
    const { container } = render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    const select = container.querySelector('select')!
    const groups = Array.from(select.querySelectorAll('optgroup'))
    expect(groups.map((group) => group.label)).toEqual(['Subscription plans', 'Pay-as-you-go'])
    expect(Array.from(groups[0].querySelectorAll('option')).map((option) => option.value)).toEqual(['kimi_code'])
    expect(Array.from(groups[1].querySelectorAll('option')).map((option) => option.value)).toEqual(['deepseek', 'openai'])
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

  it('resets the primary model when the primary provider changes to avoid a mismatch', async () => {
    // OpenAI has its own curated model so the switch can pick a valid one.
    vi.mocked(fetchRuntimeConfig).mockResolvedValue({
      ...payload(),
      providers: {
        ...payload().providers,
        openai: {
          ...payload().providers.openai,
          configured: true,
          enabled: true,
          api_key_configured: true,
          models: ['openai/gpt-5.5'],
        },
      },
    })
    useUiStore.getState().openProviders()
    render(<ProvidersPage />)
    await screen.findByText('Fetch from provider')

    // The primary provider select currently reflects deepseek; switch it to openai.
    const primarySelect = (screen.getAllByRole('combobox') as HTMLSelectElement[]).find(
      (s) => s.value === 'deepseek',
    )!
    fireEvent.change(primarySelect, { target: { value: 'openai' } })

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
    const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
    // The stale deepseek model must not survive the provider switch.
    expect(arg.runtime).toMatchObject({ provider: 'openai', model: 'openai/gpt-5.5' })
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

  describe('custom providers', () => {
    function customPayload(): RuntimeConfigPayload {
      const base = payload()
      const custom = (over: Partial<RuntimeConfigPayload['providers'][string]>) => ({
        ...base.providers.openai,
        api_key_required: false,
        api_base_required: true,
        is_custom: true,
        ...over,
      })
      return {
        ...base,
        runtime: { ...base.runtime, critic_provider: 'custom_lab', critic_model: 'lab-model' },
        providers: {
          auto: base.providers.auto,
          custom: custom({ display_name: 'Custom' }),
          custom_lab: custom({ display_name: 'Lab vLLM', enabled: true, configured: true, api_base: 'http://lab/v1', models: ['lab-model'] }),
          deepseek: { ...base.providers.deepseek, is_custom: false },
          openai: { ...base.providers.openai, is_custom: false },
        },
      }
    }

    const railButton = (label: string) =>
      screen.getAllByText(label).map((el) => el.closest('button')).find(Boolean)!

    beforeEach(() => {
      vi.mocked(fetchRuntimeConfig).mockResolvedValue(customPayload())
      vi.mocked(saveProvidersConfig).mockResolvedValue(customPayload())
    })

    it('adds a named custom provider and saves it', async () => {
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      fireEvent.click(await screen.findByText('+ Add custom provider'))

      const nameInput = await screen.findByRole('textbox', { name: 'Name' })
      expect(nameInput).toHaveValue('Custom 2')
      // Unsaved providers cannot be tested yet.
      expect(screen.getByText('Fetch from provider')).toBeDisabled()
      fireEvent.change(nameInput, { target: { value: 'Team gateway' } })
      fireEvent.change(screen.getByPlaceholderText('Leave empty to use the provider default'), { target: { value: 'https://gw/v1' } })
      expect(railButton('Team gateway')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
      const providers = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0].providers!
      const [id, update] = Object.entries(providers).find(([name]) => name.startsWith('custom_') && name !== 'custom_lab')!
      expect(id).toMatch(/^custom_[a-z0-9]{1,32}$/)
      expect(update).toEqual({ api_base: 'https://gw/v1', models: [], enabled: true, name: 'Team gateway' })
    })

    it('adds a custom provider of the user\'s own when the team manages "custom"', async () => {
      const team = customPayload()
      team.providers.custom = { ...team.providers.custom, display_name: 'ECNU', managed_by: 'team', api_key_preview: null }
      team.team = { revision: 'r1', providers: ['custom'], model_params: false, defaults: [] }
      vi.mocked(fetchRuntimeConfig).mockResolvedValue(team)
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      fireEvent.click(await screen.findByText('+ Add custom provider'))

      const nameInput = await screen.findByRole('textbox', { name: 'Name' })
      expect(screen.queryByText(/Your Team Server administrators manage/)).not.toBeInTheDocument()
      fireEvent.change(nameInput, { target: { value: 'My gateway' } })
      fireEvent.change(screen.getByPlaceholderText('Leave empty to use the provider default'), { target: { value: 'https://mine/v1' } })
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
      const providers = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0].providers!
      expect(providers).not.toHaveProperty('custom')
      const [, update] = Object.entries(providers).find(([name]) => name.startsWith('custom_') && name !== 'custom_lab')!
      expect(update).toEqual({ api_base: 'https://mine/v1', models: [], enabled: true, name: 'My gateway' })
    })

    it('renames a custom provider and blocks duplicate or empty names', async () => {
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      await screen.findByText('Fetch from provider')
      fireEvent.click(railButton('Lab vLLM'))

      const nameInput = await screen.findByRole('textbox', { name: 'Name' })
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.change(nameInput, { target: { value: ' deepseek ' } })
      expect(screen.getByRole('alert')).toHaveTextContent('Another provider is already named "DeepSeek"')

      // Saving is refused while a name collides.
      fireEvent.click(screen.getByText('Save'))
      expect(await screen.findByText('Another provider is already named "DeepSeek". Choose a different name.', { selector: 'span' })).toBeInTheDocument()
      expect(saveProvidersConfig).not.toHaveBeenCalled()

      fireEvent.change(nameInput, { target: { value: '  ' } })
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a name for this provider.')

      fireEvent.change(nameInput, { target: { value: 'Lab cluster' } })
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
      const providers = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0].providers!
      expect(providers.custom_lab).toMatchObject({ name: 'Lab cluster' })
    })

    it('jumps to the custom provider whose name collides when saving', async () => {
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      await screen.findByText('Fetch from provider')
      fireEvent.click(railButton('Lab vLLM'))
      fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Custom' } })
      fireEvent.click(railButton('DeepSeek'))
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()

      fireEvent.click(screen.getByText('Save'))
      expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Custom')
      expect(saveProvidersConfig).not.toHaveBeenCalled()
    })

    it('deletes an additional custom provider and unbinds roles that used it', async () => {
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      await screen.findByText('Fetch from provider')
      fireEvent.click(railButton('Custom'))
      // The built-in custom provider can be renamed but not deleted.
      expect(await screen.findByRole('textbox', { name: 'Name' })).toBeInTheDocument()
      expect(screen.queryByText('Delete provider')).toBeNull()

      fireEvent.click(railButton('Lab vLLM'))
      fireEvent.click(await screen.findByText('Delete provider'))
      expect(screen.queryAllByText('Lab vLLM').filter((el) => el.closest('button'))).toHaveLength(0)

      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(saveProvidersConfig).toHaveBeenCalled())
      const arg = vi.mocked(saveProvidersConfig).mock.calls.at(-1)![0]
      expect(arg.providers?.custom_lab).toBeNull()
      expect(arg.runtime?.critic_provider).toBe('auto')
      expect(arg.runtime?.critic_model).toBe('')
    })

    it('hides multi-custom controls for engines without is_custom', async () => {
      vi.mocked(fetchRuntimeConfig).mockResolvedValue(payload())
      useUiStore.getState().openProviders()
      render(<ProvidersPage />)
      await screen.findByText('Fetch from provider')
      expect(screen.queryByText('+ Add custom provider')).toBeNull()
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    })
  })
})

