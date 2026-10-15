import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJournalProfiles } from '@/services/journals'
import { journalFixture } from '@/test/journalFixtures'

vi.mock('@/services/journals', async (original) => ({ ...await original<typeof import('@/services/journals')>(), fetchJournalProfiles: vi.fn().mockResolvedValue([]) }))

vi.mock('@/services/api', () => ({
  commandWorkflowProject: vi.fn(),
  commandWorkflowRun: vi.fn(),
  createWorkflowRun: vi.fn(),
  fetchWorkflowSnapshot: vi.fn(),
  importWorkflowArtifact: vi.fn(),
  validateDataPath: vi.fn(),
}))

vi.mock('@/services/websocket', () => ({
  wsClient: {
    connected: true,
    send: vi.fn(),
  },
}))

import { createWorkflowRun, fetchWorkflowSnapshot, validateDataPath } from '@/services/api'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { ProjectTask, WorkflowSnapshot } from '@/types'
import { WorkflowWorkspace } from './WorkflowWorkspace'

const task: ProjectTask = {
  id: 'PRJ-1',
  label: 'Project',
  status: 'in_progress',
  title: 'Project',
  coreQuestion: 'Why?',
  experiments: [],
  knowledge: [],
  research: { references: [], notes: [] },
  result: {},
  startedAt: '2026-07-23T00:00:00Z',
}

const snapshot: WorkflowSnapshot = {
  workflow_contract_version: 1,
  project_id: 'PRJ-1',
  project_sequence: 1,
  workflow: {
    contract_version: 1,
    status: 'active',
    revision: 1,
    last_project_sequence: 1,
    selected_run_id: 'run-1',
    handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
  },
  runs: [{
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'run-1',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Initiation 1',
    status: 'queued',
    revision: 1,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    inputs: [],
    outputs: [],
    attempt: { number: 0 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:run-1',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: { intent: 'Find a direction' },
  }],
}

describe('WorkflowWorkspace module entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowStore.getState().clear()
    useProjectStore.setState({
      tasks: [task],
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      activeStage: 'modules',
      mode: 'auto',
      agentProfile: 'research',
    } as never)
    useSettingsStore.setState({ language: 'en', streamResponses: true })
    useUiStore.setState({ agentPanelCollapsed: true })
    useAgentStore.setState({
      connected: true,
      logsByProject: {},
      streamingBySession: {},
    })
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'run-1', project_sequence: 1 })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
  })

  it('collapses legacy status panels by default and allows repeated debug toggling', () => {
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': 'run-1' },
    })
    const view = render(<WorkflowWorkspace />)

    const toggle = screen.getByRole('button', { name: /Debug.*Run status/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Module runs')).not.toBeVisible()
    expect(screen.getByText('Revision')).not.toBeVisible()
    expect(screen.getByRole('region', { name: 'Project overview' })).toBeVisible()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Module runs')).toBeVisible()
    expect(screen.getByText('Revision')).toBeVisible()

    fireEvent.click(toggle)
    expect(screen.getByText('Module runs')).not.toBeVisible()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    view.unmount()
    useSettingsStore.setState({ language: 'zh' })
    render(<WorkflowWorkspace />)
    expect(screen.getByRole('button', { name: /Debug.*运行状态/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('模块运行')).not.toBeVisible()
  })

  it('shows a goal example tailored to each workflow stage', () => {
    useSettingsStore.setState({ language: 'zh' })
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /调研.*启动模块/ }))
    expect(screen.getByLabelText('本次运行目标')).toHaveAttribute(
      'placeholder',
      '例如：调研该方向近三年的关键论文，并提出三个可验证的研究方向。',
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: /实验.*启动模块/ }))
    expect(screen.getByLabelText('本次运行目标')).toHaveAttribute(
      'placeholder',
      '例如：基于已有数据复现基线方案，对比两种方法，并用预设指标评估结果。',
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: /结果交付.*启动模块/ }))
    expect(screen.getByLabelText('本次运行目标')).toHaveAttribute(
      'placeholder',
      '例如：汇总已完成实验的关键结果与图表，生成一份结构清晰、可追溯的研究报告。',
    )
  })

  it('keeps the experiment handoff discoverable until a completed research candidate is selected', () => {
    const researchRun = {
      ...snapshot.runs[0], status: 'completed' as const, outputs: ['research-artifact'],
      module_data: { research_result: { directions: [
        { id: 'D1', title: 'Direction A', rationale: 'First option' },
        { id: 'D2', title: 'Direction B', rationale: 'Second option' },
      ] } },
    }
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': { ...snapshot, runs: [researchRun] } },
      selectedRunByProject: { 'PRJ-1': researchRun.run_id },
      selectedCandidateByProject: { 'PRJ-1': { initiation: null } },
    })
    render(<WorkflowWorkspace />)

    const next = screen.getByRole('button', { name: 'Continue to Experiment →' })
    expect(next).toBeVisible()
    expect(next).toBeDisabled()
    expect(next).toHaveAttribute('title', 'Select a candidate item first')

    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: Direction B' }))
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(screen.getByRole('dialog')).toBeVisible()
    expect((screen.getByLabelText('Goal for this run') as HTMLTextAreaElement).value).toContain('Direction B')
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
  })

  it.each(['running', 'waiting_input', 'failed'] as const)('does not continue a selected %s research run', (status) => {
    const run = { ...snapshot.runs[0], status, outputs: ['partial-artifact'] }
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': { ...snapshot, runs: [run] } },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    render(<WorkflowWorkspace />)

    const next = screen.getByRole('button', { name: 'Continue to Experiment →' })
    expect(next).toBeVisible()
    expect(next).toBeDisabled()
    expect(next).toHaveAttribute('title', 'The candidate run must be completed first')
    fireEvent.click(next)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    expect(wsClient.send).not.toHaveBeenCalled()
  })

  it('collects a goal, creates an enqueued run, opens its module, and sends the first message', async () => {
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Research.*Start module/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()

    const intent = screen.getByLabelText('Goal for this run')
    expect(intent).toHaveValue('Why?')
    fireEvent.change(intent, { target: { value: 'Find three testable research directions' } })
    fireEvent.change(screen.getByLabelText('Your references'), {
      target: { value: 'https://doi.org/10.1000/example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'initiation',
        moduleData: {
          confirmation_policy: { mode: 'required' },
          intent: 'Find three testable research directions',
          literature_review: {
            enabled: true,
            sources: [
              'pubmed',
              'google_scholar',
              'arxiv',
              'semantic_scholar',
              'crossref',
              'europe_pmc',
            ],
          },
          references: 'https://doi.org/10.1000/example',
        },
        inputs: undefined,
        enqueue: true,
      })
    })
    expect(useProjectStore.getState().activeStage).toBe('research')
    expect(useUiStore.getState().agentPanelCollapsed).toBe(false)
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Selected sources: PubMed, Google Scholar'),
      session_id: 'PRJ-1',
      loop_mode: 'project',
      workflow_run_id: 'run-1',
      workflow_module_type: 'initiation',
    }))
    const visiblePrompt = useAgentStore.getState().logsByProject['PRJ-1:run:run-1']?.[0]?.content
    expect(visiblePrompt).toContain('Find three testable research directions')
    expect(visiblePrompt).toContain('User references:\nhttps://doi.org/10.1000/example')
    expect(visiblePrompt).toContain('structured research result')
    expect(visiblePrompt).toContain('auditable reference cards')
  })

  it('keeps the overview constrained to the viewport after opening a module and returning', () => {
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': 'run-1' },
    })
    const firstView = render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Open selected' }))
    expect(useProjectStore.getState().activeStage).toBe('research')
    firstView.unmount()

    useProjectStore.setState({ activeStage: 'modules' })
    render(<WorkflowWorkspace />)

    const overview = screen.getByRole('region', { name: 'Project overview' })
    expect(overview.parentElement).toHaveClass('xl:h-full', 'xl:min-h-0')
    expect(overview).toHaveClass('xl:min-h-0', 'xl:overflow-hidden')
    const researchStage = screen.getByRole('heading', { name: '1. Research' }).closest('.relative')
    expect(researchStage).toHaveClass('xl:min-h-0')
    expect(researchStage).not.toHaveClass('h-full')
  })

  it('adds multiple external inputs and warns only for external paths in strict mode', async () => {
    vi.mocked(validateDataPath).mockImplementation(async (path) => ({ ok: true,
      outside_workspace: path.startsWith('/external'), restrict_to_workspace: true }))
    render(<WorkflowWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Experiment.*Start module/i }))
    fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/external/data' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add path' }))
    fireEvent.change(screen.getByLabelText('Additional input path 2'), { target: { value: '/workspace/code' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start and open module' })).toBeEnabled())
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Back up important data')
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))
    await waitFor(() => expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', expect.objectContaining({
      moduleData: expect.objectContaining({ external_read_paths: ['/external/data', '/workspace/code'] }),
    })))
  })

  it.each([['auto', 1], ['auto', 2], ['manual', 1], ['manual', 2]] as const)('persists %s execution and %s acceptance with experiment limits', async (mode, contractVersion) => {
    useProjectStore.setState({ mode: 'manual', contractVersion: 2 }) // legacy preferences must not set the new defaults
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Experiment.*Start module/i }))
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Compat' })).toHaveAttribute('aria-pressed', 'true')
    const execution = screen.getByRole('group', { name: 'Experiment execution mode' })
    const acceptance = screen.getByRole('group', { name: 'Experiment acceptance mode' })
    expect(execution.parentElement).toBe(acceptance.parentElement)
    expect(execution.parentElement).toHaveClass('grid-cols-2')
    if (contractVersion === 2) fireEvent.click(screen.getByRole('button', { name: 'Strict' }))
    if (mode === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add stopping condition' }))
    fireEvent.change(screen.getByLabelText('Stopping metric 1'), {
      target: { value: 'accuracy' },
    })
    fireEvent.change(screen.getByLabelText('Stopping operator 1'), {
      target: { value: '>=' },
    })
    fireEvent.change(screen.getByLabelText('Stopping value 1'), {
      target: { value: '0.95' },
    })
    fireEvent.change(screen.getByLabelText('Maximum experiments'), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText('Token limit'), {
      target: { value: '50000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'experiment',
        moduleData: {
          confirmation_policy: { mode: 'required' },
          intent: 'Why?',
          experiment_execution_mode: mode,
          experiment_contract_version: contractVersion,
          automation_policy: {
            logic: 'AND',
            goals: [{ metric: 'accuracy', operator: '>=', value: 0.95 }],
            maxExperiments: 8,
            maxTokens: 50000,
          },
        },
        inputs: undefined,
        enqueue: true,
      })
    })
  })

  it.each([false, true])('starts a continued branch with inherited artifacts and journal selection=%s', async (selectJournal) => {
    vi.mocked(fetchJournalProfiles).mockResolvedValue([journalFixture])
    const completedSnapshot: WorkflowSnapshot = {
      ...snapshot,
      project_sequence: 2,
      workflow: { ...snapshot.workflow, selected_run_id: 'source-run' },
      runs: [{
        ...snapshot.runs[0],
        run_id: 'source-run',
        module_type: 'experiment',
        status: 'completed',
        revision: 2,
        outputs: ['artifact-1', 'artifact-2'],
        module_data: {
          intent: 'Find a direction',
          completion_summary: 'Three directions selected.',
        },
      }],
    }
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(completedSnapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({
      run_id: 'delivery-run',
      project_sequence: 3,
    })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': completedSnapshot },
      selectedRunByProject: { 'PRJ-1': 'source-run' },
    })

    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: 2. artifact-2' }))
    fireEvent.click(screen.getByRole('button', { name: /Debug.*Run status/ }))
    const handoffHeading = await screen.findByText('Continue from this result (new branch)')
    const handoffSection = handoffHeading.parentElement
    expect(handoffSection).not.toBeNull()
    fireEvent.click(
      Array.from(handoffSection!.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Delivery'),
      )!,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Inherits 1 artifact/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: 'Write a concise research report from the selected direction' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Journal Article/ }))
    if (selectJournal) {
      await waitFor(() => expect(screen.getByLabelText('Target journal')).toBeEnabled())
      fireEvent.change(screen.getByLabelText('Target journal'), { target: { value: 'mrm' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'delivery',
        enqueue: true,
        moduleData: {
          confirmation_policy: { mode: 'required' },
          delivery_format: 'paper_article',
          intent: 'Write a concise research report from the selected direction',
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
        inputs: [{ artifact_id: 'artifact-2' }],
      })
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Target format: Journal Article (.docx)'),
      workflow_run_id: 'delivery-run',
      workflow_module_type: 'delivery',
    }))
  })

  it('can start an already queued run so existing stranded branches recover', async () => {
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': 'run-1' },
    })

    render(<WorkflowWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: /Debug.*Run status/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))

    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Find a direction'),
      workflow_run_id: 'run-1',
      workflow_module_type: 'initiation',
    }))
  })

  it('uses the research brief language for the visible initiation prompt', async () => {
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Research.*Start module/i }))
    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: '调研近三年的肝纤维化分级研究' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('请执行本次立项与文献调研'),
      }))
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('结构化研究结果'),
    }))
  })

  it('keeps the dialog open and explains when the agent socket is disconnected', async () => {
    useAgentStore.setState({ connected: false })
    ;(wsClient as { connected: boolean }).connected = false
    render(<WorkflowWorkspace />)

    expect(screen.queryByRole('button', { name: /Planning.*Start module/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Experiment.*Start module/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    expect(await screen.findByText(/Agent chat is not connected yet/)).toBeInTheDocument()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    ;(wsClient as { connected: boolean }).connected = true
  })

  it('shows candidate items in all three stages and branches from a changed research choice', async () => {
    const pipelineSnapshot: WorkflowSnapshot = {
      ...snapshot,
      project_sequence: 6,
      workflow: { ...snapshot.workflow, selected_run_id: 'research-run' },
      runs: [
        {
          ...snapshot.runs[0],
          run_id: 'research-run',
          label: 'Research options',
          status: 'completed',
          outputs: ['research-bundle'],
          module_data: {
            intent: 'Find directions',
            research_result: {
              schema_version: 1,
              references: [],
              notes: [],
              searches: [],
              gaps: [],
              directions: [
                { id: 'direction-a', title: 'Direction A', rationale: 'Fast validation.' },
                { id: 'direction-b', title: 'Direction B', rationale: 'Higher upside.' },
                { id: 'direction-c', title: 'Direction C', rationale: 'Unexplored branch.' },
              ],
            },
            interaction: {
              interaction_id: 'choose-direction',
              interaction_type: 'choose_direction',
              title: 'Choose direction',
              prompt: 'Choose one',
              choices: [
                { id: 'direction-a', label: 'Direction A' },
                { id: 'direction-b', label: 'Direction B' },
                { id: 'direction-c', label: 'Direction C' },
              ],
              response_schema: {
                type: 'object',
                required: ['direction_id'],
                properties: { direction_id: { type: 'string' } },
              },
              allow_freeform: false,
              response: { direction_id: 'direction-a' },
            },
          },
        },
        {
          ...snapshot.runs[0],
          run_id: 'experiment-run',
          module_type: 'experiment',
          label: 'Experiment candidate',
          status: 'completed',
          outputs: ['experiment-result'],
          module_data: {
            parent_run_id: 'research-run',
            completion_summary: 'Validated result',
            upstream_selection: { run_id: 'research-run', item_id: 'direction-a' },
          },
        },
        {
          ...snapshot.runs[0],
          run_id: 'delivery-run',
          module_type: 'delivery',
          label: 'Delivery candidate',
          status: 'completed',
          outputs: ['delivery-report', 'delivery-source'],
          module_data: {
            parent_run_id: 'experiment-run',
            delivery_format: 'presentation',
            output_path: 'result/exports/report.pdf',
            upstream_selection: { run_id: 'experiment-run', item_id: 'experiment-result' },
          },
        },
        {
          ...snapshot.runs[0],
          run_id: 'experiment-run-b',
          module_type: 'experiment',
          label: 'Alternative experiment candidate',
          status: 'completed',
          inputs: [{ artifact_id: 'research-bundle' }],
          outputs: ['experiment-result-b'],
          module_data: {
            parent_run_id: 'research-run',
            completion_summary: 'Alternative validated result',
            upstream_selection: { run_id: 'research-run', item_id: 'direction-b' },
          },
        },
        {
          ...snapshot.runs[0],
          run_id: 'delivery-run-b',
          module_type: 'delivery',
          label: 'Alternative delivery candidate',
          status: 'completed',
          inputs: [{ artifact_id: 'experiment-result-b' }],
          outputs: ['delivery-report-b'],
          module_data: {
            parent_run_id: 'experiment-run-b',
            output_path: 'result/exports/alternative.pdf',
            upstream_selection: { run_id: 'experiment-run-b', item_id: 'experiment-result-b' },
          },
        },
      ],
    }
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(pipelineSnapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'experiment-branch', project_sequence: 7 })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': pipelineSnapshot },
      selectedRunByProject: { 'PRJ-1': 'research-run' },
    })

    render(<WorkflowWorkspace />)

    expect(screen.getByRole('heading', { name: '1. Research' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2. Experiment' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '3. Delivery' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Project overview' })).toHaveClass('flex-1', 'min-h-[32rem]')
    expect(screen.getByRole('button', { name: 'Select candidate: Direction A' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Select candidate: Direction A' }).parentElement).toHaveClass(
      'h-full',
      'overflow-y-auto',
    )
    expect(screen.getByRole('button', { name: 'Select candidate: Validated result' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select candidate: report.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select candidate: report.pdf' })).toHaveTextContent('2 artifacts')
    expect(screen.getAllByRole('button', { name: /^Select candidate:/ })).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Select candidate: Alternative validated result' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: Direction B' }))
    expect(screen.getByRole('button', { name: 'Select candidate: Alternative validated result' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Select candidate: alternative.pdf' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Select candidate: Validated result' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: Direction C' }))
    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']?.initiation).toEqual({
      runId: 'research-run',
      itemId: 'direction-c',
    })
    expect(screen.getByText('This research item has no experiment branch yet.')).toBeInTheDocument()
    expect(screen.getByText('Select an experiment item to load its delivery branch.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select candidate: Alternative validated result' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Continue to Experiment/ }))
    expect(screen.getByText(/Selected “Direction C”/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', expect.objectContaining({
        moduleType: 'experiment',
        inputs: [{ artifact_id: 'research-bundle' }],
        moduleData: expect.objectContaining({
          parent_run_id: 'research-run',
          upstream_selection: {
            module_type: 'initiation',
            run_id: 'research-run',
            item_id: 'direction-c',
            label: 'Direction C',
          },
        }),
      }))
    })
  })
})
