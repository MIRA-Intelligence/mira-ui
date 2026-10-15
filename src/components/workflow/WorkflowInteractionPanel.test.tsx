import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/websocket', () => ({ wsClient: { connected: true, send: vi.fn() } }))

import { wsClient } from '@/services/websocket'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { WorkflowInteraction, WorkflowRun } from '@/types'
import { WorkflowInteractionPanel } from './WorkflowInteractionPanel'

const command = vi.fn()
function makeRun(id = 'question-1', overrides: Partial<WorkflowInteraction> = {}): WorkflowRun {
  return {
    schema_version: 1, workflow_contract_version: 1, run_id: 'run', project_id: 'project',
    module_type: 'initiation', label: 'Research', status: 'waiting_input', revision: 1,
    created_at: '', updated_at: '', inputs: [], outputs: [], attempt: { number: 1 }, attempts: [],
    conversation_key: 'ui:project:run:run', last_project_sequence: 1, last_run_sequence: 1,
    module_data: { interaction: {
      interaction_id: id, interaction_type: 'clarify_requirements', title: `Question ${id}`,
      prompt: 'What should this research help you decide?',
      response_schema: { type: 'object', required: ['selection'], properties: {
        selection: { type: 'string' }, notes: { type: 'string' },
      } },
      choices: [{ id: 'feasible', label: 'Feasible options (Recommended)', description: 'Use available data.' }],
      allow_freeform: true, ...overrides,
    } },
  }
}

describe('WorkflowInteractionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    command.mockResolvedValue({})
    useWorkflowStore.getState().clear()
    useWorkflowStore.setState({ commandRun: command })
    useSettingsStore.setState({ language: 'en' })
  })

  it('shows choice explanations, saves notes, and resumes without selecting a candidate', async () => {
    render(<WorkflowInteractionPanel projectId="project" run={makeRun()} />)
    expect(screen.getByText('Use available data.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Feasible options/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep it small' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('project', 'run', 'submit_interaction', {
      interaction_id: 'question-1', response: { selection: 'feasible', notes: 'Keep it small' },
    }))
    expect(useWorkflowStore.getState().selectedCandidateByProject.project).toBeUndefined()
    await waitFor(() => expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({ workflow_run_id: 'run' })))
  })

  it('starts each new clarification with clean selection and notes', () => {
    const { rerender } = render(<WorkflowInteractionPanel projectId="project" run={makeRun()} />)
    fireEvent.click(screen.getByRole('button', { name: /Feasible options/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Previous answer' } })
    rerender(<WorkflowInteractionPanel projectId="project" run={makeRun('question-2', { interaction_type: 'resolve_conflict' })} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Feasible options/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled()
  })

  it('accepts a custom answer after deselecting an offered choice', async () => {
    render(<WorkflowInteractionPanel projectId="project" run={makeRun()} />)
    const choice = screen.getByRole('button', { name: /Feasible options/ })
    fireEvent.click(choice)
    fireEvent.click(choice)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Let the AI suggest a focus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('project', 'run', 'submit_interaction', {
      interaction_id: 'question-1', response: { selection: 'Let the AI suggest a focus' },
    }))
  })

  it('requires an explicit approval or a revision with notes', async () => {
    render(<WorkflowInteractionPanel projectId="project" run={makeRun('approval', {
      interaction_type: 'approve_research_scope', choices: [
        { id: 'approve', label: 'Approve' }, { id: 'revise', label: 'Revise' },
      ],
    })} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Some notes alone' } })
    expect(screen.getByRole('button', { name: 'Approve and continue' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))
    expect(screen.getByRole('button', { name: 'Request revision' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Focus on existing data' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request revision' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('project', 'run', 'submit_interaction', {
      interaction_id: 'approval', response: { selection: 'revise', notes: 'Focus on existing data' },
    }))
  })

  it('keeps the answer editable after a failed submission', async () => {
    command.mockRejectedValueOnce(new Error('Connection lost'))
    render(<WorkflowInteractionPanel projectId="project" run={makeRun()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Overview only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    await screen.findByText('Connection lost')
    expect(screen.getByRole('textbox')).toHaveValue('Overview only')
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeEnabled()
    expect(wsClient.send).not.toHaveBeenCalled()
  })
})
