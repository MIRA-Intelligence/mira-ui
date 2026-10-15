import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/services/api', async (original) => ({
  ...await original<typeof import('@/services/api')>(),
  fetchPlan: vi.fn(), fetchPlanContract: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/services/websocket', () => ({ wsClient: { send: vi.fn() } }))
vi.mock('@/components/artifacts', () => ({ ArtifactPreview: ({ path }: { path: string }) => <div>{path}</div> }))

import { fetchPlan } from '@/services/api'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { ExperimentTimeline } from './ExperimentTimeline'
import { TaskDetail } from '../task/TaskDetail'
import type { TaskPlan } from '@/types'
import type { WorkflowRun, WorkflowSnapshot } from '@/types'
import { buildWorkflowCandidates } from '@/lib/workflowCandidates'

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.getState().clear()
  useSettingsStore.setState({ language: 'en' })
  useProjectStore.setState({
    selectedTaskId: 'project', selectedExpId: null, activeStage: 'experiment', appMode: 'project',
    contractsByTask: {},
    tasks: [{ id: 'project', label: 'Project', title: 'Project', coreQuestion: 'Question',
      status: 'in_progress', experiments: [], knowledge: [], research: { references: [], notes: [] },
      result: {}, startedAt: '2026-10-10' }],
  })
})

it('renders Run-local records in the old list and detail, retains legacy items and switches branches', async () => {
  vi.mocked(fetchPlan).mockResolvedValue({ experiments: [
    { id: 'Exp001', title: 'Legacy baseline', status: 'completed', conclusion: 'Legacy result' },
    { id: 'workflow:run-a:Exp001', experiment_id: 'Exp001', workflow_run_id: 'run-a', workflow_run_label: 'Branch A',
      title: 'Controlled baseline', status: 'completed', hypothesis: 'First hypothesis',
      results: { metrics: { mae: 0.7 }, findings: 'First findings', artifacts: ['results/first.csv'] } },
    { id: 'workflow:run-b:Exp001', experiment_id: 'Exp001', workflow_run_id: 'run-b', workflow_run_label: 'Branch B',
      title: 'Negative control', status: 'completed', hypothesis: 'Second hypothesis', conclusion: 'No incremental gain' },
  ] } as unknown as TaskPlan)
  render(<><ExperimentTimeline /><TaskDetail /></>)
  expect(screen.getByText('Ready to start')).toBeVisible()
  await act(() => useProjectStore.getState().refreshPlan('project'))
  expect(screen.queryByText('Ready to start')).not.toBeInTheDocument()
  expect(screen.getByText('3/3')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Controlled baseline/ }))
  expect(useWorkflowStore.getState().selectedRunByProject.project).toBe('run-a')
  expect(screen.getByText('First hypothesis')).toBeVisible()
  expect(screen.getByText('0.7000')).toBeVisible()
  expect(screen.getByText('First findings')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Negative control/ }))
  expect(useWorkflowStore.getState().selectedRunByProject.project).toBe('run-b')
  expect(screen.getByText('Second hypothesis')).toBeVisible()
  expect(screen.getByText('No incremental gain')).toBeVisible()
  expect(screen.queryByText('First hypothesis')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Legacy baseline/ }))
  expect(screen.getByText('Legacy result')).toBeVisible()
})

it('keeps the timeline, candidate cards and detail on the same experiment', async () => {
  const records = [
    { id: 'Exp001', title: 'Mechanism', status: 'completed', hypothesis: 'Mechanism hypothesis' },
    { id: 'Exp002', title: 'Control', status: 'completed', hypothesis: 'Control hypothesis' },
  ]
  const run = { run_id: 'run-a', project_id: 'project', module_type: 'experiment', status: 'completed',
    label: 'Experiment run', outputs: ['report', 'figure', 'csv', 'bundle'], inputs: [],
    updated_at: '2026-10-10', module_data: { experiments: records },
  } as unknown as WorkflowRun
  const snapshot: WorkflowSnapshot = {
    workflow_contract_version: 1, project_id: 'project', project_sequence: 1, runs: [run],
    workflow: { contract_version: 1, status: 'active', revision: 1, last_project_sequence: 1,
      handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] } },
  }
  useWorkflowStore.setState({ snapshots: { project: snapshot }, selectedRunByProject: { project: 'run-a' } })
  vi.mocked(fetchPlan).mockResolvedValue({ experiments: records.map((item) => ({ ...item,
    id: `workflow:run-a:${item.id}`, experiment_id: item.id, workflow_run_id: 'run-a',
  })) } as unknown as TaskPlan)
  await act(() => useProjectStore.getState().refreshPlan('project'))
  render(<><ExperimentTimeline /><TaskDetail /></>)
  expect(buildWorkflowCandidates([run], 'experiment')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Select candidate: Exp002 · Control' }))
  expect(useProjectStore.getState().selectedExpId).toBe('workflow:run-a:Exp002')
  expect(screen.getByText('Control hypothesis')).toBeVisible()
  expect(screen.queryByText('Mechanism hypothesis')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Exp001Mechanism/ }))
  expect(screen.getByRole('button', { name: 'Select candidate: Exp001 · Mechanism' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Mechanism hypothesis')).toBeVisible()
  expect(useWorkflowStore.getState().selectedCandidateByProject.project?.experiment?.itemId).toBe('Exp001')
  act(() => useWorkflowStore.setState({ snapshots: { project: { ...snapshot, runs: [{ ...run,
    module_data: { experiments: [records[0], { ...records[1], status: 'failed' }] },
  }] } } }))
  fireEvent.click(screen.getByRole('button', { name: 'Select candidate: Exp002 · Control' }))
  expect(screen.getByRole('button', { name: 'Continue to Delivery →' })).toBeDisabled()
})
