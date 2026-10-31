import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  describe('auto-approve countdown', () => {
    const approval = { interaction_type: 'approve_experiment_plan', choices: [
      { id: 'approve', label: 'Approve', value: 'approve' }, { id: 'revise', label: 'Revise', value: 'revise' },
    ] }
    function experimentRun(mode?: 'auto' | 'manual', overrides: Partial<WorkflowInteraction> = approval): WorkflowRun {
      const run = makeRun('gate', overrides)
      return {
        ...run,
        module_type: 'experiment',
        module_data: { ...run.module_data, ...(mode ? { experiment_execution_mode: mode } : {}) },
      }
    }
    const tick = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        await act(async () => { vi.advanceTimersByTime(1000) })
      }
    }

    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('approves an auto-mode experiment gate after a visible 10s countdown', async () => {
      render(<WorkflowInteractionPanel projectId="project" run={experimentRun('auto')} />)
      expect(screen.getByRole('status')).toHaveTextContent('approving and continuing in 10s')
      await tick(3000)
      expect(screen.getByRole('status')).toHaveTextContent('in 7s')
      expect(command).not.toHaveBeenCalled()
      await tick(7000)
      expect(command).toHaveBeenCalledWith('project', 'run', 'submit_interaction', {
        interaction_id: 'gate', response: { selection: 'approve' },
      })
      expect(command).toHaveBeenCalledTimes(1)
    })

    it('treats a Run without a recorded mode as auto, like the engine does', () => {
      render(<WorkflowInteractionPanel projectId="project" run={experimentRun()} />)
      expect(screen.getByRole('status')).toHaveTextContent('10s')
    })

    it('never times out in manual mode', async () => {
      render(<WorkflowInteractionPanel projectId="project" run={experimentRun('manual')} />)
      expect(screen.queryByRole('status')).toBeNull()
      await tick(15000)
      expect(command).not.toHaveBeenCalled()
    })

    it('stops when the user picks a choice, types notes or cancels', async () => {
      const { unmount } = render(<WorkflowInteractionPanel projectId="project" run={experimentRun('auto')} />)
      fireEvent.click(screen.getByRole('button', { name: 'Revise' }))
      expect(screen.queryByRole('status')).toBeNull()
      unmount()

      const typed = render(<WorkflowInteractionPanel projectId="project" run={experimentRun('auto')} />)
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wait' } })
      expect(screen.queryByRole('status')).toBeNull()
      typed.unmount()

      render(<WorkflowInteractionPanel projectId="project" run={experimentRun('auto')} />)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel auto-approve' }))
      expect(screen.queryByRole('status')).toBeNull()
      await tick(15000)
      expect(command).not.toHaveBeenCalled()
    })

    it('leaves other stages and non-confirmation questions alone', async () => {
      const initiation = { ...experimentRun('auto'), module_type: 'initiation' as const }
      const { unmount } = render(<WorkflowInteractionPanel projectId="project" run={initiation} />)
      expect(screen.queryByRole('status')).toBeNull()
      unmount()

      render(<WorkflowInteractionPanel projectId="project" run={experimentRun('auto', {})} />)
      expect(screen.queryByRole('status')).toBeNull()
      await tick(15000)
      expect(command).not.toHaveBeenCalled()
    })
  })
})
