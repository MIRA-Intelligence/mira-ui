import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/websocket', () => ({
  wsClient: { send: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onMessage: vi.fn(), onStatus: vi.fn() },
}))

import { TaskDetail } from './TaskDetail'
import type { ProjectTask } from '@/types'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'PRJ-1',
    label: 'P',
    status: 'in_progress',
    title: 'Project',
    coreQuestion: 'Why?',
    experiments: [],
    knowledge: [],
    research: { references: [], notes: [] },
    result: {},
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

const projInitial = useProjectStore.getState()

function setProject(partial: Partial<ReturnType<typeof useProjectStore.getState>>) {
  useProjectStore.setState({
    tasks: [makeTask()],
    selectedTaskId: 'PRJ-1',
    selectedExpId: null,
    activeStage: 'research',
    ...partial,
  } as never)
}

describe('TaskDetail', () => {
  beforeEach(() => {
    useProjectStore.setState(projInitial, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('prompts to select a project when nothing is selected', () => {
    useProjectStore.setState({ tasks: [], selectedTaskId: null } as never)
    render(<TaskDetail />)
    expect(screen.getByText('Select a project to get started')).toBeInTheDocument()
  })

  it('renders the research stage', () => {
    setProject({ activeStage: 'research' })
    render(<TaskDetail />)
    // ResearchView core question block
    expect(screen.getByText('Why?')).toBeInTheDocument()
  })

  it('renders the result stage', () => {
    setProject({ activeStage: 'result' })
    render(<TaskDetail />)
    // ResultView empty state
    expect(screen.getByText('📝')).toBeInTheDocument()
  })

  it('renders the knowledge panel for the knowledge sentinel', () => {
    setProject({ activeStage: 'experiment', selectedExpId: '__knowledge__' })
    render(<TaskDetail />)
    expect(screen.getByText('No knowledge accumulated yet', { exact: false })).toBeInTheDocument()
  })

  it('shows the ready-to-start hint when there are no experiments', () => {
    setProject({ activeStage: 'experiment', selectedExpId: 'missing' })
    render(<TaskDetail />)
    expect(screen.getByText('Ready to start')).toBeInTheDocument()
  })

  it('asks to pick an experiment when one is selected but not found', () => {
    setProject({
      activeStage: 'experiment',
      selectedExpId: 'nope',
      tasks: [makeTask({ experiments: [{ id: 'e1' } as never] })],
    })
    render(<TaskDetail />)
    expect(screen.getByText('Select an experiment from the timeline')).toBeInTheDocument()
  })
})
