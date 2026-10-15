import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowStore } from './workflowStore'
import { useProjectStore } from './projectStore'
import type { WorkflowSnapshot } from '@/types'

vi.mock('@/services/api', () => ({
  fetchWorkflowSnapshot: vi.fn(),
  createWorkflowRun: vi.fn(),
  commandWorkflowRun: vi.fn(),
  commandWorkflowProject: vi.fn(),
}))

import { commandWorkflowProject, commandWorkflowRun, createWorkflowRun, fetchWorkflowSnapshot } from '@/services/api'

const snapshot = {
  workflow_contract_version: 1,
  project_id: 'PRJ-1',
  project_sequence: 2,
  workflow: {
    contract_version: 1,
    status: 'active' as const,
    revision: 2,
    last_project_sequence: 2,
    selected_run_id: 'run-1',
    handoff_policy: { mode: 'manual' as const, interrupt_grace_seconds: 10, rules: [] },
  },
  runs: [{
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'run-1',
    project_id: 'PRJ-1',
    module_type: 'delivery' as const,
    label: 'Delivery 1',
    status: 'created' as const,
    revision: 1,
    created_at: '2026-07-22T00:00:00Z',
    updated_at: '2026-07-22T00:00:00Z',
    inputs: [],
    outputs: [],
    attempt: { number: 0 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:run-1',
    last_project_sequence: 2,
    last_run_sequence: 1,
    module_data: { intent: 'polish' },
  }],
}

describe('workflowStore', () => {
  const experimentSnapshot = (): WorkflowSnapshot => ({ ...snapshot, runs: [{
    ...snapshot.runs[0], module_type: 'experiment', status: 'completed', outputs: ['first', 'second', 'shared'],
    module_data: { experiments: [
      { id: 'Exp001', title: 'First', status: 'completed', evidence_refs: [{ ref_id: 'first' }] },
      { id: 'Exp002', title: 'Second', status: 'completed', results: { metrics: { mae: 0.73 } }, evidence_refs: [{ ref_id: 'second' }] },
    ] },
  }] })

  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowStore.getState().clear()
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
  })

  it('loads the authoritative snapshot and selects its run', async () => {
    await useWorkflowStore.getState().loadProject('PRJ-1')
    expect(useWorkflowStore.getState().snapshots['PRJ-1']).toEqual(snapshot)
    expect(useWorkflowStore.getState().selectedRunByProject['PRJ-1']).toBe('run-1')
  })

  it('synchronizes experiment candidate selection with the detail without leaving overview', () => {
    useWorkflowStore.setState({ snapshots: { 'PRJ-1': experimentSnapshot() } })
    useProjectStore.setState({ selectedTaskId: 'PRJ-1', selectedExpId: null, activeStage: 'modules' })
    useWorkflowStore.getState().selectCandidate('PRJ-1', 'experiment', { runId: 'run-1', itemId: 'Exp002' })
    expect(useProjectStore.getState().selectedExpId).toBe('workflow:run-1:Exp002')
    expect(useProjectStore.getState().activeStage).toBe('modules')
  })

  it('hands off only the selected experiment record and its owned/shared attachments', async () => {
    const source = experimentSnapshot()
    useWorkflowStore.setState({ snapshots: { 'PRJ-1': source } })
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'delivery', project_sequence: 3 })
    await useWorkflowStore.getState().createRun('PRJ-1', 'delivery', 'Write report', {
      parentRunId: 'run-1', inputArtifactIds: ['first', 'second', 'shared'],
      moduleData: { upstream_selection: { module_type: 'experiment', run_id: 'run-1', item_id: 'Exp002' } },
    })
    expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', expect.objectContaining({
      inputs: [{ artifact_id: 'second' }, { artifact_id: 'shared' }],
      moduleData: expect.objectContaining({
        parent_run_id: 'run-1', source_run_revision: 1,
        upstream_selection: expect.objectContaining({ experiment_id: 'Exp002', item_id: 'Exp002' }),
        selected_experiment: (source.runs[0].module_data.experiments as unknown[])[1],
        shared_artifact_ids: ['shared'],
      }),
    }))
  })

  it('rejects stale file-based selections and incomplete experiment handoffs', async () => {
    const source = experimentSnapshot()
    const experiments = source.runs[0].module_data.experiments as Array<Record<string, unknown>>
    experiments[1].status = 'failed'
    useWorkflowStore.setState({ snapshots: { 'PRJ-1': source } })
    for (const itemId of ['second', 'Exp002']) {
      await expect(useWorkflowStore.getState().createRun('PRJ-1', 'delivery', 'Write', {
        parentRunId: 'run-1', moduleData: { upstream_selection: { run_id: 'run-1', item_id: itemId } },
      })).rejects.toThrow('Select a completed experiment')
    }
    expect(createWorkflowRun).not.toHaveBeenCalled()
  })

  it('creates a direct-entry module run and refreshes', async () => {
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'run-2', project_sequence: 3 })
    const runId = await useWorkflowStore.getState().createRun(
      'PRJ-1',
      'experiment',
      'own spec',
      {
        enqueue: true,
        moduleData: {
          automation_policy: { logic: 'AND', goals: [], maxExperiments: 4 },
        },
      },
    )
    expect(runId).toBe('run-2')
    expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
      moduleType: 'experiment',
      moduleData: {
        automation_policy: { logic: 'AND', goals: [], maxExperiments: 4 },
        intent: 'own spec',
      },
      enqueue: true,
    })
  })

  it('applies commands using the current run revision', async () => {
    await useWorkflowStore.getState().loadProject('PRJ-1')
    vi.mocked(commandWorkflowRun).mockResolvedValue({ project_sequence: 3 })
    await useWorkflowStore.getState().commandRun('PRJ-1', 'run-1', 'enqueue')
    expect(commandWorkflowRun).toHaveBeenCalledWith('PRJ-1', 'run-1', 'enqueue', 1, undefined)
  })

  it('updates the project handoff policy using the project revision', async () => {
    await useWorkflowStore.getState().loadProject('PRJ-1')
    vi.mocked(commandWorkflowProject).mockResolvedValue({ project_sequence: 3 })
    await useWorkflowStore.getState().setHandoffMode('PRJ-1', 'auto')
    expect(commandWorkflowProject).toHaveBeenCalledWith('PRJ-1', 'set_handoff_policy', 2, {
      handoff_policy: { mode: 'auto', interrupt_grace_seconds: 10, rules: [] },
    })
  })

  it('ignores replayed events at or below the snapshot cursor', async () => {
    await useWorkflowStore.getState().loadProject('PRJ-1')
    vi.mocked(fetchWorkflowSnapshot).mockClear()
    useWorkflowStore.getState().handleSocketMessage({
      message_type: 'workflow_event',
      workflow_contract_version: 1,
      event_id: 'event-2',
      project_id: 'PRJ-1',
      project_sequence: 2,
      event_type: 'run.created',
      occurred_at: '2026-07-22T00:00:00Z',
      project_revision: 2,
      payload: {},
    })
    expect(fetchWorkflowSnapshot).not.toHaveBeenCalled()
  })

  it('clears transient activity instead of leaving a stale working label', () => {
    useWorkflowStore.getState().handleSocketMessage({
      message_type: 'activity', project_id: 'PRJ-1', run_id: 'run-1', summary: 'Searching papers',
    })
    expect(useWorkflowStore.getState().activityByRun['run-1']).toBe('Searching papers')
    useWorkflowStore.getState().handleSocketMessage({
      message_type: 'activity', project_id: 'PRJ-1', run_id: 'run-1', summary: '',
    })
    expect(useWorkflowStore.getState().activityByRun['run-1']).toBeUndefined()
  })

  it('keeps the last useful Run activity when a generic heartbeat arrives', () => {
    useWorkflowStore.getState().handleSocketMessage({
      message_type: 'activity', project_id: 'PRJ-1', run_id: 'run-1', summary: 'read evidence.md',
    })
    useWorkflowStore.getState().handleSocketMessage({
      message_type: 'activity', project_id: 'PRJ-1', run_id: 'run-1', summary: 'Mira is working...',
    })

    expect(useWorkflowStore.getState().activityByRun['run-1']).toBe('read evidence.md')
  })

  it('shares candidate choices across views and clears stale downstream selections', () => {
    const store = useWorkflowStore.getState()
    store.selectCandidate('PRJ-1', 'initiation', { runId: 'research-1', itemId: 'direction-a' })
    store.selectCandidate('PRJ-1', 'experiment', { runId: 'experiment-1', itemId: 'result-a' })
    store.selectCandidate('PRJ-1', 'delivery', { runId: 'delivery-1', itemId: 'report-a' })

    store.selectCandidate('PRJ-1', 'initiation', { runId: 'research-1', itemId: 'direction-b' })

    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']).toEqual({
      initiation: { runId: 'research-1', itemId: 'direction-b' },
      experiment: null,
      delivery: null,
    })
    expect(useWorkflowStore.getState().selectedRunByProject['PRJ-1']).toBe('research-1')
  })

  it('loads the existing downstream pipeline when an upstream candidate is selected', () => {
    const researchRun = {
      ...snapshot.runs[0],
      run_id: 'research-1',
      module_type: 'initiation' as const,
      status: 'completed' as const,
      outputs: ['research-bundle'],
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A' },
            { id: 'direction-b', title: 'Direction B' },
          ],
        },
      },
    }
    const experimentRun = {
      ...snapshot.runs[0],
      run_id: 'experiment-b',
      module_type: 'experiment' as const,
      status: 'completed' as const,
      inputs: [{ artifact_id: 'research-bundle' }],
      outputs: ['result-b'],
      module_data: {
        parent_run_id: 'research-1',
        upstream_selection: { run_id: 'research-1', item_id: 'direction-b' },
      },
    }
    const deliveryRun = {
      ...snapshot.runs[0],
      run_id: 'delivery-b',
      module_type: 'delivery' as const,
      status: 'completed' as const,
      inputs: [{ artifact_id: 'result-b' }],
      outputs: ['report-b'],
      module_data: {
        parent_run_id: 'experiment-b',
        upstream_selection: { run_id: 'experiment-b', item_id: 'result-b' },
      },
    }
    useWorkflowStore.setState({
      snapshots: {
        'PRJ-1': { ...snapshot, runs: [researchRun, experimentRun, deliveryRun] },
      },
    })

    useWorkflowStore.getState().selectCandidate(
      'PRJ-1',
      'initiation',
      { runId: 'research-1', itemId: 'direction-b' },
    )

    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']).toEqual({
      initiation: { runId: 'research-1', itemId: 'direction-b' },
      experiment: { runId: 'experiment-b', itemId: 'result-b' },
      delivery: { runId: 'delivery-b', itemId: 'report-b' },
    })
  })
})
