import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamUsagePage } from './TeamUsagePage'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { useUiStore } from '@/stores/uiStore'
import type { PlanUsageRow, QuotaSettings, UsageReport } from '@/services/teamUsage'

vi.mock('@/services/teamUsage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/teamUsage')>()
  return {
    ...actual,
    fetchUsageReport: vi.fn(),
    fetchQuotas: vi.fn(),
    fetchPlanUsage: vi.fn(),
    saveQuotas: vi.fn(),
    downloadUsageCsv: vi.fn(),
  }
})

const { fetchUsageReport, fetchQuotas, fetchPlanUsage, saveQuotas, downloadUsageCsv } = await import('@/services/teamUsage')

const ORIGIN = 'https://mira.example.com'
const zero = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0, calls: 0, unreported_calls: 0 }
const status = (limit: number | null, used: number) => ({
  limit, used, remaining: limit == null ? null : Math.max(limit - used, 0),
  warn: limit != null && used * 100 >= limit * 80, exceeded: limit != null && used >= limit,
  resets_at: '2026-10-18T00:00:00+08:00',
})

function byUser(): UsageReport {
  return {
    from: '2026-10-01', to: '2026-10-17', group_by: ['user'],
    rows: [
      { ...zero, user: 'alice', input_tokens: 2_000_000, output_tokens: 500_000, total_tokens: 2_500_000, calls: 40,
        unreported_calls: 2, quota: { daily: status(2_000_000, 2_100_000), monthly: status(null, 2_500_000) } },
      { ...zero, user: 'bob', input_tokens: 900, output_tokens: 100, total_tokens: 1000, calls: 3,
        quota: { daily: status(2_000_000, 1000), monthly: status(null, 1000) } },
    ],
    totals: { ...zero, input_tokens: 2_000_900, output_tokens: 500_100, total_tokens: 2_501_000, calls: 43 },
  }
}

function byModel(): UsageReport {
  return {
    from: '2026-10-01', to: '2026-10-17', group_by: ['provider', 'model'],
    rows: [{ ...zero, provider: 'custom', model: 'ecnu-chat', total_tokens: 2_501_000, calls: 43 }],
    totals: { ...zero, total_tokens: 2_501_000, calls: 43 },
  }
}

const quotas: QuotaSettings = { default: { daily: 2_000_000, monthly: null }, users: { carol: { daily: 0, monthly: null } },
  warn_percent: 80 }

// A server with subscription quotas (ChatGPT plans).
const planQuotas: QuotaSettings = {
  ...quotas,
  subscription: { default: { five_hour: 80, weekly: 90 }, users: { alice: { five_hour: null, weekly: 0 } } },
}

const planWindow = (used: number, cap: number | null, minutes: number) => ({
  used_percent: used, window_minutes: minutes, resets_at: 1_900_000_000, current: true, limit_percent: cap,
  exceeded: cap != null && used >= cap, warn: cap != null && used * 100 >= cap * 80,
})

const planUsage: PlanUsageRow[] = [
  { user: 'erin', engine_running: true, subscription_quota: { five_hour: 80, weekly: 90 }, subscription: { providers: {
    openai_codex: { updated_at: 1, limit_reached: null, limits: { five_hour: 80, weekly: 90 },
      windows: { five_hour: planWindow(42, 80, 300), weekly: planWindow(91, 90, 10080) } } } } },
]

describe('TeamUsagePage', () => {
  beforeEach(() => {
    vi.mocked(fetchUsageReport).mockReset().mockImplementation(async (_origin, options) =>
      options?.groupBy?.includes('model') ? byModel() : byUser())
    vi.mocked(fetchQuotas).mockReset().mockResolvedValue(quotas)
    vi.mocked(fetchPlanUsage).mockReset().mockResolvedValue([])
    vi.mocked(saveQuotas).mockReset().mockImplementation(async (_origin, settings) => settings)
    useSettingsStore.setState({ language: 'en' })
    useTeamServerStore.setState({ phase: 'signedIn', origin: ORIGIN,
      user: { name: 'bob', displayName: 'Bob', roles: ['user', 'admin'] } })
    useUiStore.setState({ teamUsageOpen: true })
  })

  it('shows everyone\'s usage, quota status and the models', async () => {
    render(<TeamUsagePage />)
    const alice = (await screen.findByText('alice')).closest('tr')!
    expect(alice).toHaveTextContent('2.5M')
    expect(alice).toHaveTextContent('(2?)')  // calls without token counts
    expect(alice).toHaveTextContent('2.1M / 2M · used up')
    expect(alice).toHaveTextContent('2.5M / unlimited')
    expect(screen.getByText('carol').closest('tr')).toHaveTextContent('–')  // an override without usage
    expect(screen.getByText('ecnu-chat')).toBeInTheDocument()
    expect(screen.getByText('All users').closest('tr')).toHaveTextContent('2.5M')
    expect(fetchUsageReport).toHaveBeenCalledWith(ORIGIN, { groupBy: ['user'] })
  })

  it('edits the default and per-user quotas and saves them', async () => {
    render(<TeamUsagePage />)
    const daily = await screen.findByRole('textbox', { name: 'Daily tokens per user' })
    expect(daily).toHaveValue('2M')
    expect(screen.getByRole('button', { name: 'Save quotas' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Monthly tokens per user' }), { target: { value: '40m' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Daily quota for alice' }), { target: { value: '5,000,000' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Daily quota for carol' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add user quota' }), { target: { value: 'dave' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add user quota' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Monthly quota for dave' }), { target: { value: 'unlimited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quotas' }))

    await waitFor(() => expect(saveQuotas).toHaveBeenCalled())
    expect(vi.mocked(saveQuotas).mock.calls[0][1]).toEqual({
      default: { daily: 2_000_000, monthly: 40_000_000 },
      users: { alice: { daily: 5_000_000, monthly: null }, dave: { daily: null, monthly: 0 } },
      warn_percent: 80,
    })
    expect(await screen.findByText(/Quotas saved/)).toBeInTheDocument()
  })

  it('refuses values that are not token amounts', async () => {
    render(<TeamUsagePage />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Daily tokens per user' }), { target: { value: 'lots' } })
    expect(screen.getByRole('alert')).toHaveTextContent('not token amounts')
    expect(screen.getByRole('button', { name: 'Save quotas' })).toBeDisabled()
  })

  it('hides ChatGPT plan caps on servers without them', async () => {
    render(<TeamUsagePage />)
    await screen.findByRole('textbox', { name: 'Daily tokens per user' })
    expect(screen.queryByText('ChatGPT plan (OpenAI Codex)')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '5-hour cap for alice' })).not.toBeInTheDocument()
  })

  it('edits the default and per-user ChatGPT plan caps alongside token quotas', async () => {
    vi.mocked(fetchQuotas).mockResolvedValue(planQuotas)
    render(<TeamUsagePage />)
    const fiveHour = await screen.findByRole('textbox', { name: '5-hour window cap per user (%)' })
    expect(fiveHour).toHaveValue('80')
    expect(screen.getByRole('textbox', { name: 'Weekly window cap per user (%)' })).toHaveValue('90')
    expect(screen.getByRole('textbox', { name: 'Weekly cap for alice' })).toHaveValue('0')
    expect(screen.getByRole('textbox', { name: '5-hour cap for alice' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save quotas' })).toBeDisabled()

    fireEvent.change(fiveHour, { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: '5-hour cap for bob' }), { target: { value: '50%' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Weekly cap for alice' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quotas' }))

    await waitFor(() => expect(saveQuotas).toHaveBeenCalled())
    expect(vi.mocked(saveQuotas).mock.calls[0][1]).toEqual({
      ...quotas,
      users: { carol: { daily: 0, monthly: null } },
      subscription: { default: { five_hour: null, weekly: 90 }, users: { bob: { five_hour: 50, weekly: null } } },
    })
    expect(fetchPlanUsage).toHaveBeenCalledTimes(2)  // reloaded after saving
  })

  it('refuses plan caps that are not percentages', async () => {
    vi.mocked(fetchQuotas).mockResolvedValue(planQuotas)
    render(<TeamUsagePage />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Weekly window cap per user (%)' }),
      { target: { value: '120' } })
    expect(screen.getByRole('alert')).toHaveTextContent('whole percentages from 1 to 100')
    expect(screen.getByRole('button', { name: 'Save quotas' })).toBeDisabled()
  })

  it('shows each user\'s ChatGPT plan windows against their caps', async () => {
    vi.mocked(fetchQuotas).mockResolvedValue(planQuotas)
    vi.mocked(fetchPlanUsage).mockResolvedValue(planUsage)
    render(<TeamUsagePage />)
    const erin = (await screen.findByText('erin')).closest('tr')!  // plan usage only, no team tokens
    expect(erin).toHaveTextContent('5h 42% / 80%')
    expect(erin).toHaveTextContent('week 91% / 90% · used up')
    expect(screen.getByText('alice').closest('tr')).toHaveTextContent('–')
  })

  it('switches to last month and exports CSV', async () => {
    vi.mocked(downloadUsageCsv).mockResolvedValue(new Blob(['user\n']))
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    render(<TeamUsagePage />)
    await screen.findByText('alice')
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }))
    await waitFor(() => expect(fetchUsageReport).toHaveBeenCalledWith(ORIGIN,
      { from: '2026-09-01', to: '2026-09-30', groupBy: ['user'] }))
    expect(screen.getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(downloadUsageCsv).toHaveBeenCalledWith(ORIGIN,
      { from: '2026-09-01', to: '2026-09-30', groupBy: ['user', 'provider', 'model'] }))
    expect(createObjectURL).toHaveBeenCalled()
  })

  it('is only for administrators', () => {
    useTeamServerStore.setState({ user: { name: 'alice', displayName: 'Alice', roles: ['user'] } })
    const { container } = render(<TeamUsagePage />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchUsageReport).not.toHaveBeenCalled()
  })

  it('closes', async () => {
    render(<TeamUsagePage />)
    const header = (await screen.findByText('Team usage & quotas')).closest('div')!.parentElement!
    fireEvent.click(within(header).getByRole('button', { name: 'Cancel' }))
    expect(useUiStore.getState().teamUsageOpen).toBe(false)
  })
})
