import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlanView } from './PlanView'
import type { ProjectTask } from '@/types'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/websocket', () => ({
  wsClient: { send: vi.fn() },
}))

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()

function makeTask(plan: ProjectTask['plan']): ProjectTask {
  return {
    id: 'PRJ-0001',
    label: 'PRJ-0001',
    status: 'in_progress',
    title: 'Demo',
    coreQuestion: 'demo',
    experiments: [],
    knowledge: [],
    research: { references: [], notes: [] },
    plan,
    result: {},
    startedAt: new Date().toISOString(),
  }
}

describe('PlanView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('resets local answers when a new questions round reuses question ids', () => {
    const firstPlan: ProjectTask['plan'] = {
      phase: 'questions',
      updatedAt: '2026-06-08T12:00:00Z',
      questions: [{ id: 'q1', prompt: 'Old goal?', kind: 'text' }],
      answers: { q1: 'old answer' },
    }
    const secondPlan: ProjectTask['plan'] = {
      phase: 'questions',
      updatedAt: '2026-06-08T12:05:00Z',
      questions: [{ id: 'q1', prompt: 'New goal?', kind: 'text' }],
      answers: {},
    }

    const { rerender } = render(<PlanView task={makeTask(firstPlan)} />)

    expect(screen.getByDisplayValue('old answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit answers' })).not.toBeDisabled()

    rerender(<PlanView task={makeTask(secondPlan)} />)

    expect(screen.getByText('New goal?')).toBeInTheDocument()
    expect(screen.queryByText('Old goal?')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your answer')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'new answer' },
    })
    expect(screen.getByRole('button', { name: 'Submit answers' })).not.toBeDisabled()
  })
})
