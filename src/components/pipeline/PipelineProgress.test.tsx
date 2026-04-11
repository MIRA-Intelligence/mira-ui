import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { PipelineProgress } from './PipelineProgress'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialUiState = useUiStore.getState()

function makeTask(running: boolean) {
  return {
    id: 'PRJ-0001',
    label: 'PRJ-0001',
    status: 'in_progress' as const,
    title: 'Demo task',
    coreQuestion: 'demo',
    currentExperiment: running ? 'Exp001' : 'Exp002',
    experiments: [
      {
        id: 'Exp001',
        title: 'Exp001',
        status: running ? 'running' as const : 'completed' as const,
      },
      {
        id: 'Exp002',
        title: 'Exp002',
        status: 'pending' as const,
      },
    ],
    knowledge: [],
    research: { references: [], notes: [] },
    result: {},
    startedAt: new Date().toISOString(),
  }
}

describe('PipelineProgress agent profile switch', () => {
  beforeEach(() => {
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useUiStore.setState(initialUiState, true)

    useSettingsStore.setState({ language: 'en' })
  })

  it('allows switching profile in auto mode when idle', () => {
    useProjectStore.setState({
      tasks: [makeTask(false)],
      selectedTaskId: 'PRJ-0001',
      mode: 'auto',
      agentProfile: 'default',
      activeStage: 'research',
    })
    useAgentStore.setState({ isStreaming: false })

    render(<PipelineProgress />)

    const engineer = screen.getByRole('button', { name: 'Engineer' })
    expect(engineer).not.toBeDisabled()
    fireEvent.click(engineer)
    expect(useProjectStore.getState().agentProfile).toBe('engineer')
  })

  it('disables switching profile while a run is active', () => {
    useProjectStore.setState({
      tasks: [makeTask(true)],
      selectedTaskId: 'PRJ-0001',
      mode: 'manual',
      agentProfile: 'default',
      activeStage: 'research',
    })
    useAgentStore.setState({ isStreaming: true })

    render(<PipelineProgress />)

    const engineer = screen.getByRole('button', { name: 'Engineer' })
    expect(engineer).toBeDisabled()
    fireEvent.click(engineer)
    expect(useProjectStore.getState().agentProfile).toBe('default')
  })

  it('allows switching contract mode when idle', () => {
    useProjectStore.setState({
      tasks: [makeTask(false)],
      selectedTaskId: 'PRJ-0001',
      mode: 'auto',
      agentProfile: 'default',
      activeStage: 'research',
    })
    useAgentStore.setState({ isStreaming: false })

    render(<PipelineProgress />)

    const strict = screen.getByRole('button', { name: 'Strict' })
    expect(strict).not.toBeDisabled()
    fireEvent.click(strict)
    const updatedTask = useProjectStore.getState().tasks.find((task) => task.id === 'PRJ-0001')
    expect(updatedTask?.contractVersion).toBe(2)
  })
})
