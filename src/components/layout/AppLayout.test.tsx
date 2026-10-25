import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./TopBar', () => ({ TopBar: () => <div>top-bar</div> }))
vi.mock('./StatusBar', () => ({ StatusBar: () => <div>status-bar</div> }))
vi.mock('@/components/pipeline/PipelineProgress', () => ({ PipelineProgress: () => <div>pipeline</div> }))
vi.mock('@/components/queue/ProjectQueue', () => ({ ProjectQueue: () => <div>project-list</div> }))
vi.mock('@/components/experiment/ExperimentTimeline', () => ({ ExperimentTimeline: () => <div>experiment-timeline</div> }))
vi.mock('@/components/task/TaskDetail', () => ({ TaskDetail: () => <div>project-content</div> }))
vi.mock('@/components/agent/AgentPanel', () => ({
  AgentPanel: () => <div>agent-panel</div>,
  AgentPanelActions: () => null,
}))
vi.mock('@/components/settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('@/components/settings/SkillsPluginsModal', () => ({ SkillsPluginsModal: () => null }))
vi.mock('@/components/providers/ProvidersPage', () => ({ ProvidersPage: () => null }))
vi.mock('@/components/update/UpdateBanner', () => ({ UpdateBanner: () => null }))
vi.mock('@/components/engine/LocalEngineUpdateModal', () => ({ LocalEngineUpdateModal: () => null }))
vi.mock('@/components/feedback/FeedbackDialog', () => ({ FeedbackDialog: () => null }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }))
vi.mock('@/hooks/useWorkflowWebSocket', () => ({ useWorkflowWebSocket: vi.fn() }))
vi.mock('@/hooks/useUpdateCheck', () => ({ useUpdateCheck: vi.fn() }))
vi.mock('@/hooks/useTurnSync', () => ({ useTurnSync: vi.fn() }))

import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import * as api from '@/services/api'
import { AppLayout } from './AppLayout'

describe('AppLayout project surfaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useUiStore.setState({ workbenchTab: 'agent', chatCenterCollapsed: false, chatCenterPreviewFile: null, agentPanelCollapsed: false })
    useSettingsStore.setState({ language: 'en' })
    useProjectStore.setState({
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      activeStage: 'modules',
    } as never)
  })

  it('gives the overview all space to the right of the project list', () => {
    render(<AppLayout />)

    expect(screen.getByText('project-list')).toBeInTheDocument()
    expect(screen.getByText('project-content')).toBeInTheDocument()
    expect(screen.queryByText('agent-panel')).not.toBeInTheDocument()
  })

  it('restores the agent panel after entering a module', () => {
    useProjectStore.setState({ activeStage: 'research' })
    render(<AppLayout />)

    expect(screen.getByText('project-list')).toBeInTheDocument()
    expect(screen.getByText('project-content')).toBeInTheDocument()
    expect(screen.getByText('agent-panel')).toBeInTheDocument()
  })

  it('opens a chat folder file in the Quick Chat center from the workbench', async () => {
    useProjectStore.setState({ appMode: 'normal', tasks: [], projectsLoaded: true })
    useChatStore.setState({ activeChatId: 'chat-1' })
    const folder = '/home/u/.mira/workspace/chats/chat-1'
    vi.spyOn(api, 'fetchChatWorkdir').mockResolvedValue({ path: folder, exists: true, home: '/home/u' })
    vi.spyOn(api, 'fetchDirectory').mockResolvedValue({
      ok: true,
      listing: {
        path: folder,
        parent: '/home/u/.mira/workspace/chats',
        home: '/home/u',
        truncated: false,
        entries: [{ name: 'a.txt', path: `${folder}/a.txt`, size: 3, mtime: 1, is_dir: false }],
      },
    })
    render(<AppLayout />)

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    const explorer = within(screen.getByPlaceholderText('Filter files…').closest('.flex-col') as HTMLElement)
    fireEvent.click(await explorer.findByText('a.txt'))
    expect(useUiStore.getState().chatCenterPreviewFile).toMatchObject({ absolutePath: `${folder}/a.txt` })
    expect(screen.getByText(`${folder}/a.txt`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Agent Chat/i }))
    expect(screen.getByText('agent-panel')).toBeInTheDocument()
    expect(screen.getByText(`${folder}/a.txt`)).toBeInTheDocument()
  })

  describe('Quick Chat home page', () => {
    const homeVisible = () => !screen.getByText('Quick chat').closest('[hidden]')
    const toggle = () => screen.getByRole('separator', { name: 'Toggle quick chat home panel' })

    beforeEach(() => {
      vi.spyOn(api, 'fetchChatWorkdir').mockResolvedValue(null)
      useProjectStore.setState({ appMode: 'normal', tasks: [] })
      useChatStore.setState({ activeChatId: null, chats: [] })
      useUiStore.setState({ chatCenterAuto: true, chatCenterCollapsed: false })
    })

    it('shows the home page with no chat selected and for a new chat', () => {
      render(<AppLayout />)
      expect(homeVisible()).toBe(true)

      act(() => { useChatStore.getState().createChat() })
      expect(homeVisible()).toBe(true)
      expect(screen.getByText('agent-panel')).toBeInTheDocument()
    })

    it('steps aside once the chat has its first message', () => {
      const id = useChatStore.getState().createChat()
      render(<AppLayout />)
      expect(homeVisible()).toBe(true)
      act(() => useChatStore.getState().touchChat(id, 'Summarise this scan'))
      expect(homeVisible()).toBe(false)
    })

    it('stays collapsed when opening a chat that has begun', () => {
      useChatStore.setState({ chats: [{ id: 'old', title: 'Earlier question', createdAt: 1, updatedAt: 1 }] })
      act(() => useChatStore.getState().selectChat('old'))
      render(<AppLayout />)
      expect(homeVisible()).toBe(false)
    })

    it('follows a manual toggle until another chat is opened', () => {
      useChatStore.setState({ chats: [
        { id: 'old', title: 'Earlier question', createdAt: 1, updatedAt: 1 },
        { id: 'other', title: 'Another', createdAt: 1, updatedAt: 2 },
      ] })
      act(() => useChatStore.getState().selectChat('old'))
      render(<AppLayout />)
      fireEvent.click(toggle())
      expect(homeVisible()).toBe(true)

      act(() => useChatStore.getState().selectChat('other'))
      expect(homeVisible()).toBe(false)
    })

    it('can be collapsed by hand on a new chat', () => {
      act(() => { useChatStore.getState().createChat() })
      render(<AppLayout />)
      fireEvent.click(toggle())
      expect(homeVisible()).toBe(false)
    })
  })

  it('resizes the Quick Chat workbench by dragging the splitter', () => {
    useProjectStore.setState({ appMode: 'normal', tasks: [] })
    useUiStore.setState({ chatCenterCollapsed: false })
    useUiStore.getState().setAgentPanelWidth(600)
    render(<AppLayout />)
    const splitter = screen.getByRole('separator', { name: 'Toggle quick chat home panel' })
    // jsdom has no pointer capture.
    splitter.setPointerCapture = vi.fn()
    splitter.releasePointerCapture = vi.fn()

    const right = window.innerWidth
    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: right - 600 })
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: right - 820 })
    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: right - 820 })
    fireEvent.click(splitter)

    expect(useUiStore.getState().agentPanelWidth).toBe(820)
    // A drag is not a click: the home pane stays open.
    expect(useUiStore.getState().chatCenterCollapsed).toBe(false)
  })
})
