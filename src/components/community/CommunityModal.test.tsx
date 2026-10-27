import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommunityModal } from './CommunityModal'
import { useCommunityStore } from '@/stores/communityStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

describe('CommunityModal approval inbox', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: true, agent_id: 'agent-1', api_base: 'http://x', autonomy_mode: 'hitl',
        code_host: 'github', domains: [], pending_count: 2, member_status: 'active',
      },
      approvals: [
        {
          id: 'p1', action: 'persona_update', status: 'pending', created_at: '2026-10-20T00:00:00Z',
          payload: { draft: 'x', workspace: '/w', diff: '+- **Domains**: plugins, agents\n' },
        },
        {
          id: 'w1', action: 'claim_work_order', status: 'pending', created_at: '2026-10-20T00:00:00Z',
          payload: { work_order_id: 'fb5c1242-b58a-4e06' },
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    })
  })

  it('shows the persona diff and labels new engine actions', () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: /^Approvals/ }))
    expect(screen.getByText('Claim work order')).toBeTruthy()
    expect(screen.getByText('fb5c1242')).toBeTruthy()
    fireEvent.click(screen.getByText('Community persona'))
    expect(screen.getByTestId('community-persona-diff').textContent).toContain('**Domains**: plugins, agents')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText("Changes apply to your agent's next action; no restart needed.")).toBeTruthy()
  })
})

describe('CommunityModal mailbox', () => {
  const markRead = vi.fn(async () => {})
  const setNotifications = vi.fn(async () => {})
  const item = (id: string, kind: 'reply' | 'mention' | 'work', read = false, extra = {}) => ({
    id, kind, type: kind === 'work' ? 'pr_landed' : kind, title: `${kind} title ${id}`, body: `${kind} body ${id}`,
    from: 'bob-agent', thread_id: 't-1', url: '', created_at: '2026-10-20T06:00:00Z', read, ...extra,
  })

  beforeEach(() => {
    markRead.mockClear()
    setNotifications.mockClear()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: true, agent_id: 'agent-1', api_base: 'http://x', autonomy_mode: 'fully_autonomous',
        code_host: 'github', domains: [], pending_count: 0, member_status: 'active',
        notifications: ['reply', 'mention', 'review', 'work'],
        unread: { total: 2, by_kind: { reply: 1, mention: 1, review: 0, work: 0, activity: 0 } },
        web_url: 'https://community.example',
      },
      approvals: [],
      inbox: [item('r1', 'reply'), item('m1', 'mention'), item('w1', 'work', true, { url: 'https://github.com/o/r/pull/1' })],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
      markRead,
      setNotifications,
    })
  })

  it('lists mail with unread counts and links to the website', () => {
    render(<CommunityModal />)
    const site = screen.getByRole('link', { name: /Open community website/ }) as HTMLAnchorElement
    expect(site.href).toBe('https://community.example/')
    expect(screen.getByRole('button', { name: /^Inbox\s*2$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Replies to me\s*1$/ })).toBeTruthy()
    expect(screen.getByText('3 messages')).toBeTruthy()
  })

  it('opening a message shows it, marks it read and links to its thread', () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByText('reply title r1'))
    expect(markRead).toHaveBeenCalledWith({ ids: ['r1'] })
    expect(screen.getAllByText('reply body r1').length).toBeGreaterThan(0)
    const link = screen.getByRole('link', { name: /View on the community website/ }) as HTMLAnchorElement
    expect(link.href).toBe('https://community.example/proposals/t-1')
    fireEvent.click(screen.getByText('Your pull request landed')) // worded from its type, not the stored title
    expect(markRead).toHaveBeenCalledTimes(1) // already read: no second call
    expect((screen.getByRole('link', { name: /Open link/ }) as HTMLAnchorElement).href).toBe('https://github.com/o/r/pull/1')
  })

  it('filters by kind and marks a whole folder read', () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: /^@Mentions/ }))
    expect(screen.getByText('1 messages')).toBeTruthy()
    expect(screen.queryByText('reply title r1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(markRead).toHaveBeenCalledWith({ kind: 'mention' })
  })

  it('explains folders the user does not receive', () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: /^Community activity/ }))
    expect(screen.getByText('You do not receive these. Turn them on in Settings.')).toBeTruthy()
  })

  it('lets the user choose what to receive, or nothing at all', () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Review requests/ }))
    expect(setNotifications).toHaveBeenLastCalledWith(['reply', 'mention', 'work'])
    fireEvent.click(screen.getByRole('checkbox', { name: /Community activity/ }))
    expect(setNotifications).toHaveBeenLastCalledWith(['reply', 'mention', 'review', 'work', 'activity'])
    fireEvent.click(screen.getByRole('checkbox', { name: /No notifications/ }))
    expect(setNotifications).toHaveBeenLastCalledWith([])
  })

  it('says so when notifications are off and hides the website link when unknown', () => {
    useCommunityStore.setState((s) => ({
      status: s.status ? { ...s.status, notifications: [], web_url: '' } : s.status,
      inbox: [],
    }))
    render(<CommunityModal />)
    expect(screen.getByText(/Notifications are off/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Open community website/ })).toBeNull()
  })
})

describe('CommunityModal join form', () => {
  const startPairing = vi.fn(async () => {})

  beforeEach(() => {
    startPairing.mockClear()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: false, agent_id: '', api_base: 'http://x', autonomy_mode: 'hitl',
        code_host: 'github', domains: ['rag'], pending_count: 0, suggested_name: 'MIRAI',
      },
      approvals: [],
      loading: false,
      error: null,
      pairing: { active: false, verificationUrl: null, userCode: null, error: null },
      refresh: vi.fn(async () => {}),
      startPairing,
    })
  })

  it('collects the name and public profile and passes them to pairing', () => {
    render(<CommunityModal />)
    expect((screen.getByRole('textbox', { name: 'Agent name' }) as HTMLInputElement).value).toBe('MIRAI')
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent name' }), { target: { value: ' Nova ' } })
    expect((screen.getByPlaceholderText('plugins, agents') as HTMLInputElement).value).toBe('rag')
    fireEvent.change(screen.getByPlaceholderText('python, react'), { target: { value: 'Python， go, python' } })
    fireEvent.click(screen.getByLabelText('Develop'))
    fireEvent.change(screen.getByRole('textbox', { name: 'One line about you' }), { target: { value: ' Builds RAG tools ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join the community' }))
    expect(startPairing).toHaveBeenCalledWith({
      name: 'Nova',
      domains: ['rag'],
      tech_stack: ['Python', 'go', 'python'],
      participation: ['answer', 'review', 'discuss'],
      bio: 'Builds RAG tools',
    })
  })

  it('needs a valid name and says what a valid one is', () => {
    render(<CommunityModal />)
    const join = screen.getByRole('button', { name: 'Join the community' }) as HTMLButtonElement
    const name = screen.getByRole('textbox', { name: 'Agent name' })
    fireEvent.change(name, { target: { value: 'my agent' } })
    expect(screen.getByText(/No spaces or @/)).toBeTruthy()
    expect(join.disabled).toBe(true)
    fireEvent.change(name, { target: { value: '' } })
    expect(join.disabled).toBe(true)
    fireEvent.change(name, { target: { value: '小米-2' } })
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect(startPairing).toHaveBeenCalledWith(expect.objectContaining({ name: '小米-2' }))
  })

  it('needs at least one way to take part', () => {
    render(<CommunityModal />)
    for (const label of ['Answer questions', 'Review code', 'Develop', 'Discuss']) {
      fireEvent.click(screen.getByLabelText(label))
    }
    expect(screen.getByText('Pick at least one.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Join the community' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows why pairing could not start, on the form', () => {
    useCommunityStore.setState({ pairing: { active: false, verificationUrl: null, userCode: null, error: 'pairing failed: bad bio' } })
    render(<CommunityModal />)
    expect(screen.getByText('pairing failed: bad bio')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join the community' })).toBeTruthy()
  })
})

describe('CommunityModal agent profile', () => {
  const profile = {
    agent_id: '35f0bd8e-e032-46b1-bb0c-c134bdc21fb1',
    name: 'Nova',
    profile: { domains: ['plugins'], tech_stack: ['python'], languages: ['en'], participation: ['answer', 'review'], bio: 'Builds plugins' },
  }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const patch = JSON.parse(String(init.body))
        if (patch.name === 'Refused') return new Response(JSON.stringify({ error: 'name: not allowed' }), { status: 400 })
        const { name, ...rest } = patch
        return new Response(JSON.stringify({ ...profile, name, profile: { ...profile.profile, ...rest } }), { status: 200 })
      }
      return new Response(JSON.stringify(profile), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: true, agent_id: profile.agent_id, api_base: 'http://x', autonomy_mode: 'hybrid',
        code_host: 'github', domains: ['plugins'], pending_count: 0, member_status: 'active', agent_name: 'Nova',
      },
      approvals: [],
      inbox: [],
      loading: false,
      error: null,
      profile: { data: null, phase: 'idle', error: null },
      refresh: vi.fn(async () => {}),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the agent as "Name #id" in the header', () => {
    render(<CommunityModal />)
    expect(screen.getByTestId('community-agent-label').textContent).toBe('Agent: Nova #35f0bd8e')
  })

  it('loads the profile in Settings and saves an edit to the community', async () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Builds plugins')).toBeTruthy()
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/community\/profile$/)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent name' }), { target: { value: 'Nova2' } })
    fireEvent.change(screen.getByPlaceholderText('python, react'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeTruthy()
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(String(url)).toMatch(/\/community\/profile$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Nova2', domains: ['plugins'], tech_stack: [], languages: ['en'], participation: ['answer', 'review'], bio: 'Builds plugins',
    })
    expect(screen.getByTestId('community-agent-label').textContent).toBe('Agent: Nova2 #35f0bd8e')
  })

  it('keeps the form open and shows why a save was refused', async () => {
    render(<CommunityModal />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const name = screen.getByRole('textbox', { name: 'Agent name' })
    fireEvent.change(name, { target: { value: 'two words' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'Refused' } }) // valid here, refused by the community
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('name: not allowed')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Agent name' }) as HTMLInputElement).value).toBe('Refused')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Builds plugins')).toBeTruthy()
  })
})
