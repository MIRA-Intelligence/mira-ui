import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJournalProfiles } from '@/services/journals'
import { journalFixture } from '@/test/journalFixtures'

vi.mock('@/services/journals', async (original) => ({ ...await original<typeof import('@/services/journals')>(), fetchJournalProfiles: vi.fn().mockResolvedValue([]) }))

vi.mock('@/services/api', () => ({
  commandWorkflowProject: vi.fn(),
  commandWorkflowRun: vi.fn(),
  createWorkflowRun: vi.fn(),
  fetchWorkflowSnapshot: vi.fn(),
  validateDataPath: vi.fn(),
}))

vi.mock('@/services/websocket', () => ({
  wsClient: {
    connected: true,
    send: vi.fn(),
  },
}))

import {
  commandWorkflowRun,
  createWorkflowRun,
  fetchWorkflowSnapshot,
  validateDataPath,
} from '@/services/api'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { ProjectTask, WorkflowRun, WorkflowSnapshot } from '@/types'
import { ModuleStageControls } from './ModuleStageControls'

const task: ProjectTask = {
  id: 'PRJ-1',
  label: 'Project',
  status: 'in_progress',
  title: 'Project',
  coreQuestion: 'Which direction should we pursue?',
  experiments: [],
  knowledge: [],
  research: { references: [], notes: [] },
  result: {},
  startedAt: '2026-07-31T00:00:00Z',
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'source-run',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Initiation 1',
    status: 'completed',
    revision: 2,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:01:00Z',
    inputs: [],
    outputs: ['artifact-1', 'artifact-2'],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:source-run',
    last_project_sequence: 2,
    last_run_sequence: 2,
    module_data: { intent: 'Review the literature' },
    ...overrides,
  }
}

function makeSnapshot(run: WorkflowRun): WorkflowSnapshot {
  return {
    workflow_contract_version: 1,
    project_id: 'PRJ-1',
    project_sequence: 2,
    workflow: {
      contract_version: 1,
      status: 'active',
      revision: 2,
      last_project_sequence: 2,
      selected_run_id: run.run_id,
      handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
    },
    runs: [run],
  }
}

describe('ModuleStageControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowStore.getState().clear()
    useProjectStore.setState({
      tasks: [task],
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      activeStage: 'research',
      mode: 'auto',
      agentProfile: 'research',
    } as never)
    useSettingsStore.setState({ language: 'en', streamResponses: true })
    useAgentStore.setState({
      connected: true,
      logsByProject: {},
      streamingBySession: {},
    })
    ;(wsClient as { connected: boolean }).connected = true
  })

  it('shows one selected delivery with both PDF and PPTX attachments in the module page', () => {
    const run = makeRun({ module_type: 'delivery', outputs: ['pdf', 'pptx'],
      module_data: { delivery_format: 'presentation', output_path: 'result/exports/presentation.pdf' },
    })
    useProjectStore.setState({ activeStage: 'result' })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': makeSnapshot(run) },
      selectedRunByProject: { 'PRJ-1': run.run_id },
      selectedCandidateByProject: { 'PRJ-1': { delivery: { runId: run.run_id, itemId: 'pptx' } } },
    })
    render(<ModuleStageControls />)
    expect(screen.getAllByRole('button', { name: /^Select candidate:/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Select candidate: presentation.pdf' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 artifacts')).toBeInTheDocument()
  })

  it.each([['auto', 1], ['auto', 2], ['manual', 1], ['manual', 2]] as const)('starts a downstream experiment with %s execution and %s acceptance', async (mode, contractVersion) => {
    const run = makeRun({ outputs: ['artifact-1'] })
    const snapshot = makeSnapshot(run)
    useProjectStore.setState({ mode: 'manual', contractVersion: 2 })
    useWorkflowStore.setState({ snapshots: { 'PRJ-1': snapshot }, selectedRunByProject: { 'PRJ-1': run.run_id } })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'experiment-run', project_sequence: 3 })
    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: /Continue to Experiment/ }))
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Compat' })).toHaveAttribute('aria-pressed', 'true')
    const execution = screen.getByRole('group', { name: 'Experiment execution mode' })
    const acceptance = screen.getByRole('group', { name: 'Experiment acceptance mode' })
    expect(execution.parentElement).toBe(acceptance.parentElement)
    expect(execution.parentElement).toHaveClass('grid-cols-2')
    if (contractVersion === 2) fireEvent.click(screen.getByRole('button', { name: 'Strict' }))
    if (mode === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create branch and start' }))
    await waitFor(() => expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', expect.objectContaining({
      moduleType: 'experiment', moduleData: expect.objectContaining({ experiment_execution_mode: mode, experiment_contract_version: contractVersion }),
    })))
  })

  it('passes user-selected external inputs to the downstream experiment', async () => {
    const run = makeRun({ outputs: ['artifact-1'] })
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({ snapshots: { 'PRJ-1': snapshot }, selectedRunByProject: { 'PRJ-1': run.run_id } })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'experiment-run', project_sequence: 3 })
    vi.mocked(validateDataPath).mockResolvedValue({ ok: true, outside_workspace: true, restrict_to_workspace: true })
    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: /Continue to Experiment/ }))
    fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/external/data' } })
    expect(screen.getByRole('button', { name: 'Create branch and start' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create branch and start' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Create branch and start' }))
    await waitFor(() => expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', expect.objectContaining({
      moduleData: expect.objectContaining({ external_read_paths: ['/external/data'] }),
    })))
  })

  it.each([false, true])('continues to Delivery with journal selection=%s', async (selectJournal) => {
    vi.mocked(fetchJournalProfiles).mockResolvedValue([journalFixture])
    const run = makeRun({ module_type: 'experiment' })
    const snapshot = makeSnapshot(run)
    useProjectStore.setState({ activeStage: 'experiment' })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({
      run_id: 'delivery-run',
      project_sequence: 3,
    })

    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: 2. artifact-2' }))
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment Report/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Journal Article/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Presentation/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Meta data/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: 'Prepare the manuscript for journal submission' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Journal Article/ }))
    if (selectJournal) {
      await waitFor(() => expect(screen.getByLabelText('Target journal')).toBeEnabled())
      fireEvent.change(screen.getByLabelText('Target journal'), { target: { value: 'mrm' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create branch and start' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'delivery',
        enqueue: true,
        inputs: [{ artifact_id: 'artifact-2' }],
        moduleData: {
          confirmation_policy: { mode: 'required' },
          delivery_format: 'paper_article',
          intent: 'Prepare the manuscript for journal submission',
          ...(selectJournal ? { target_journal: 'mrm', journal_profile_version: '2026-10-12' } : {}),
          output_path: 'result/exports/journal_article.docx',
          output_type: 'article_docx',
          parent_run_id: 'source-run',
          upstream_selection: {
            module_type: 'experiment',
            run_id: 'source-run',
            item_id: 'artifact-2',
            label: '2. artifact-2',
          },
        },
      })
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Target format: Journal Article (.docx)'),
      workflow_run_id: 'delivery-run',
      workflow_module_type: 'delivery',
    }))
    expect(useProjectStore.getState().activeStage).toBe('result')
  })

  it('keeps the handoff available when the candidate list is collapsed', () => {
    const run = makeRun()
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })

    render(<ModuleStageControls />)

    const collapse = screen.getByRole('button', { name: 'Collapse candidate outputs' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'module-candidate-output-list')
    expect(screen.getByRole('button', { name: 'Select candidate: 1. artifact-1' })).toBeInTheDocument()
    expect(screen.getByText('Next: continue from this result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: 1. artifact-1' }))

    fireEvent.click(collapse)

    const expand = screen.getByRole('button', { name: 'Expand candidate outputs' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/2 candidates.*Selected: 1. artifact-1/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select candidate: 1. artifact-1' })).not.toBeInTheDocument()
    expect(screen.getByText('Next: continue from this result')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue to Experiment →' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Experiment →' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect((screen.getByLabelText('Goal for this run') as HTMLTextAreaElement).value).toContain('1. artifact-1')
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(expand)

    expect(screen.getByRole('button', { name: 'Collapse candidate outputs' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Select candidate: 1. artifact-1' })).toBeInTheDocument()
    expect(screen.getByText('Next: continue from this result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment/ })).toBeInTheDocument()
  })

  it('keeps a collapsed, unselected candidate handoff disabled with guidance', () => {
    const run = makeRun()
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': makeSnapshot(run) },
      selectedRunByProject: { 'PRJ-1': run.run_id },
      selectedCandidateByProject: { 'PRJ-1': { initiation: null } },
    })
    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse candidate outputs' }))
    const next = screen.getByRole('button', { name: 'Continue to Experiment →' })
    expect(next).toBeVisible()
    expect(next).toBeDisabled()
    expect(screen.getByText('Expand the candidate list above and select one item first.')).toBeVisible()
    fireEvent.click(next)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
  })

  it.each([
    ['initiation', 'research'], ['planning', 'plan'], ['experiment', 'experiment'], ['delivery', 'result'],
  ] as const)('shows the pending %s form after switching from another stage', (moduleType, stage) => {
    const otherRun = makeRun({ run_id: 'other-run', module_type: moduleType === 'initiation' ? 'experiment' : 'initiation' })
    const run = makeRun({
      run_id: 'pending-run', module_type: moduleType, status: 'waiting_input', outputs: [],
      module_data: { interaction: {
        interaction_id: 'data-input', interaction_type: 'clarify_requirements',
        title: 'Confirm available data', prompt: 'Which data can this experiment use?',
        choices: [{ id: 'existing', value: 'existing', label: 'Existing data' }],
        response_schema: { type: 'object', required: ['selection'] }, allow_freeform: true,
      } },
    })
    useProjectStore.setState({ activeStage: stage })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': { ...makeSnapshot(run), runs: [otherRun, run] } },
      selectedRunByProject: { 'PRJ-1': otherRun.run_id },
    })

    const { container } = render(<ModuleStageControls />)
    expect(screen.getByText('Confirm available data')).toBeVisible()
    expect(useWorkflowStore.getState().selectedRunByProject['PRJ-1']).toBe(run.run_id)
    expect(container.firstChild).not.toHaveClass('max-h-[45vh]')
    expect(screen.getByText('Confirm available data').compareDocumentPosition(
      screen.getByText('Candidate outputs in this module'),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse candidate outputs' }))
    expect(screen.getByText('Confirm available data')).toBeVisible()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
  })

  it('brings repeated questions back into view without reusing an answer', () => {
    const interaction = {
      interaction_id: 'question-1', interaction_type: 'clarify_requirements',
      title: 'First question', prompt: 'Choose data',
      choices: [{ id: 'data', value: 'data', label: 'Existing data' }],
      response_schema: { type: 'object', required: ['selection'] }, allow_freeform: true,
    }
    const run = makeRun({ status: 'waiting_input', module_data: { interaction } })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': makeSnapshot(run) },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    const { container } = render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Existing data' }))
    const controls = container.firstChild as HTMLDivElement
    controls.scrollTop = 300
    act(() => useWorkflowStore.setState({ snapshots: { 'PRJ-1': makeSnapshot({
      ...run, revision: 3, module_data: { interaction: {
        ...interaction, interaction_id: 'question-2', title: 'Second question', interaction_type: 'resolve_conflict',
      } },
    }) } }))
    expect(controls.scrollTop).toBe(0)
    expect(screen.getByText('Second question')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Existing data' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled()
  })

  it('renders and submits structured interaction directly in the module center column', async () => {
    const run = makeRun({
      status: 'waiting_input',
      module_data: {
        interaction: {
          interaction_id: 'direction-choice',
          interaction_type: 'select',
          title: 'Choose a research direction',
          prompt: 'Select the direction to continue with.',
          choices: [
            { id: 'direction-a', label: 'Direction A', value: 'direction-a' },
            { id: 'direction-b', label: 'Direction B', value: 'direction-b' },
          ],
          response_schema: {
            type: 'object',
            required: ['selected_direction'],
            properties: { selected_direction: { type: 'string' } },
          },
          allow_freeform: false,
        },
      },
    })
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(commandWorkflowRun).mockResolvedValue({} as never)

    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Direction B' }))
    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']?.initiation).toEqual({
      runId: 'source-run',
      itemId: 'direction-b',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    await waitFor(() => {
      expect(commandWorkflowRun).toHaveBeenCalledWith(
        'PRJ-1',
        'source-run',
        'submit_interaction',
        2,
        {
          interaction_id: 'direction-choice',
          response: { selected_direction: 'direction-b' },
        },
      )
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('direction-choice'),
      workflow_run_id: 'source-run',
      workflow_module_type: 'initiation',
    }))
  })

  it('keeps execution confirmation local instead of selecting a deliverable candidate', async () => {
    const run = makeRun({
      status: 'waiting_input',
      module_data: {
        confirmation_policy: { mode: 'required' },
        interaction: {
          interaction_id: 'research-approval',
          interaction_type: 'approve_research_scope',
          title: 'Approve the research brief',
          prompt: 'Question, sources, boundaries, and expected outcome.',
          choices: [
            { id: 'approve', label: 'Approve', value: 'approve' },
            { id: 'revise', label: 'Revise', value: 'revise' },
          ],
          response_schema: {
            type: 'object',
            required: ['selection'],
            properties: {
              selection: { type: 'string' },
              notes: { type: 'string' },
            },
          },
          allow_freeform: true,
        },
      },
    })
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(commandWorkflowRun).mockResolvedValue({} as never)

    render(<ModuleStageControls />)

    expect(screen.getByText('AI execution confirmation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and continue' }))

    await waitFor(() => {
      expect(commandWorkflowRun).toHaveBeenCalledWith(
        'PRJ-1',
        'source-run',
        'submit_interaction',
        2,
        {
          interaction_id: 'research-approval',
          response: { selection: 'approve' },
        },
      )
    })
  })
})
