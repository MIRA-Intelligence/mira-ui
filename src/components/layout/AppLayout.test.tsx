import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('opens a workspace file in the Quick Chat center from the workbench', async () => {
    useProjectStore.setState({
      appMode: 'normal',
      tasks: [{
        id: 'PRJ-A', label: 'Project One', title: '', status: 'pending',
        experiments: [], knowledge: [], research: { references: [], notes: [] }, result: {}, startedAt: '',
      }],
      projectsLoaded: true,
    })
    vi.spyOn(api, 'fetchProjectFiles').mockResolvedValue([
      { name: 'a.txt', path: 'data/a.txt', size: 3, mtime: 1, is_dir: false },
    ])
    render(<AppLayout />)

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    const explorer = within(screen.getByPlaceholderText('Filter files…').closest('.flex-col') as HTMLElement)
    fireEvent.click(await explorer.findByText('Project One'))
    fireEvent.click(screen.getByText('data'))
    fireEvent.click(screen.getByText('a.txt'))
    expect(useUiStore.getState().chatCenterPreviewFile).toMatchObject({
      projectId: 'PRJ-A', relativePath: 'data/a.txt',
    })
    expect(screen.getByText('PRJ-A/data/a.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Agent Chat/i }))
    expect(screen.getByText('agent-panel')).toBeInTheDocument()
    expect(screen.getByText('PRJ-A/data/a.txt')).toBeInTheDocument()
  })

  it('can reopen the center after a new chat focuses the workbench', () => {
    useProjectStore.setState({ appMode: 'normal', tasks: [] })
    useUiStore.getState().focusQuickChatWorkbench()
    render(<AppLayout />)
    const toggle = screen.getByRole('separator', { name: 'Toggle quick chat home panel' })
    expect(useUiStore.getState().chatCenterCollapsed).toBe(true)
    expect(screen.getByText('agent-panel')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(useUiStore.getState().chatCenterCollapsed).toBe(false)
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
