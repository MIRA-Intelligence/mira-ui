import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./TopBar', () => ({ TopBar: () => <div>top-bar</div> }))
vi.mock('./StatusBar', () => ({ StatusBar: () => <div>status-bar</div> }))
vi.mock('@/components/pipeline/PipelineProgress', () => ({ PipelineProgress: () => <div>pipeline</div> }))
vi.mock('@/components/queue/ProjectQueue', () => ({ ProjectQueue: () => <div>project-list</div> }))
vi.mock('@/components/experiment/ExperimentTimeline', () => ({ ExperimentTimeline: () => <div>experiment-timeline</div> }))
vi.mock('@/components/task/TaskDetail', () => ({ TaskDetail: () => <div>project-content</div> }))
vi.mock('@/components/agent/AgentPanel', () => ({ AgentPanel: () => <div>agent-panel</div> }))
vi.mock('@/components/settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('@/components/settings/SkillsPluginsModal', () => ({ SkillsPluginsModal: () => null }))
vi.mock('@/components/providers/ProvidersPage', () => ({ ProvidersPage: () => null }))
vi.mock('@/components/update/UpdateBanner', () => ({ UpdateBanner: () => null }))
vi.mock('@/components/engine/LocalEngineUpdateModal', () => ({ LocalEngineUpdateModal: () => null }))
vi.mock('@/components/feedback/FeedbackDialog', () => ({ FeedbackDialog: () => null }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }))
vi.mock('@/hooks/useWorkflowWebSocket', () => ({ useWorkflowWebSocket: vi.fn() }))
vi.mock('@/hooks/useUpdateCheck', () => ({ useUpdateCheck: vi.fn() }))

import { useProjectStore } from '@/stores/projectStore'
import { AppLayout } from './AppLayout'

describe('AppLayout project surfaces', () => {
  beforeEach(() => {
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
})
