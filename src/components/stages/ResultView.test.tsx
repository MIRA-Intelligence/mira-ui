import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResultView } from './ResultView'
import type { ProjectTask, ResultData, WorkflowRun, WorkflowSnapshot } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'PRJ-1',
    label: 'P',
    status: 'completed',
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

describe('ResultView', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: 'en' })
    useWorkflowStore.getState().clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there is no result content', () => {
    render(<ResultView data={{}} task={makeTask()} />)
    expect(screen.getByText('📝')).toBeInTheDocument()
  })

  it('renders summary, sections and key findings without the legacy output card', () => {
    const data: ResultData = {
      summary: 'Final summary',
      outputPath: '/proj/out/report.md',
      outputType: 'markdown',
      sections: [{ title: 'Intro', content: 'body text' }],
    }
    const task = makeTask({ result: data, knowledge: ['finding A', 'finding B'] })
    render(<ResultView data={data} task={task} />)

    expect(screen.getByText('Final summary')).toBeInTheDocument()
    expect(screen.getByText('Intro')).toBeInTheDocument()
    expect(screen.getByText('body text')).toBeInTheDocument()
    expect(screen.queryByText('/proj/out/report.md')).not.toBeInTheDocument()
    expect(screen.getByText('finding A')).toBeInTheDocument()
    expect(screen.queryByText('Export results')).not.toBeInTheDocument()
  })

  it('renders the selected Delivery Run PDF artifact in the center result view', async () => {
    const run: WorkflowRun = {
      schema_version: 1,
      workflow_contract_version: 1,
      run_id: 'delivery-run',
      project_id: 'PRJ-1',
      module_type: 'delivery',
      label: 'Delivery',
      status: 'completed',
      revision: 3,
      created_at: '2026-07-31T00:00:00Z',
      updated_at: '2026-07-31T00:01:00Z',
      inputs: [],
      outputs: ['artifact-pdf'],
      attempt: { number: 1 },
      attempts: [],
      conversation_key: 'ui:PRJ-1:run:delivery-run',
      last_project_sequence: 3,
      last_run_sequence: 3,
      module_data: {},
    }
    const snapshot: WorkflowSnapshot = {
      workflow_contract_version: 1,
      project_id: 'PRJ-1',
      workflow: {
        contract_version: 1,
        status: 'active',
        revision: 3,
        last_project_sequence: 3,
        selected_run_id: run.run_id,
        handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
      },
      runs: [run],
      project_sequence: 3,
    }
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artifact_id: 'artifact-pdf',
        artifact_type: 'presentation',
        artifact_schema_version: 1,
        label: 'presentation.pdf',
        media_type: 'application/pdf',
        byte_size: 2048,
        sha256: 'abc',
        payload_ref: '.mira/workflows/artifacts/artifact-pdf/payload.pdf',
        created_at: '2026-07-31T00:01:00Z',
        derived_from: [],
      }),
      text: async () => '',
    }))

    render(<ResultView data={{}} task={makeTask()} />)

    await waitFor(() => {
      expect(screen.getByTitle('presentation.pdf')).toBeInTheDocument()
    })
    expect(screen.getByText('Download original')).toBeInTheDocument()
  })
})
