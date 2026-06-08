import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentStore } from './agentStore'
import { useProjectStore } from './projectStore'

const initialState = useProjectStore.getState()
const initialAgentState = useAgentStore.getState()

describe('projectStore runtime preferences', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useProjectStore.setState(initialState, true)
    useAgentStore.setState(initialAgentState, true)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ run_mode: 'auto', agent_profile: 'research', contract_version: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    useProjectStore.setState({
      tasks: [{
        id: 'PRJ-0001',
        label: 'PRJ-0001',
        status: 'in_progress',
        title: 'Demo',
        coreQuestion: 'demo',
        runMode: 'auto',
        agentProfile: 'research',
        contractVersion: 1,
        currentExperiment: 'Exp001',
        experiments: [{ id: 'Exp001', title: 'exp', status: 'pending' }],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: new Date().toISOString(),
      }],
      selectedTaskId: 'PRJ-0001',
      selectedExpId: 'Exp001',
      mode: 'auto',
      agentProfile: 'research',
      contractVersion: 1,
    })
  })

  it('stores runtime preferences on selected project task', () => {
    const store = useProjectStore.getState()
    store.setAgentProfile('research')
    store.setMode('manual')
    store.setContractVersion(2)

    const task = useProjectStore.getState().tasks.find((t) => t.id === 'PRJ-0001')
    expect(task?.agentProfile).toBe('research')
    expect(task?.runMode).toBe('manual')
    expect(task?.contractVersion).toBe(2)
    expect(useProjectStore.getState().agentProfile).toBe('research')
    expect(useProjectStore.getState().mode).toBe('manual')
    expect(useProjectStore.getState().contractVersion).toBe(2)
  })

  it('clears stale logs when creating a reused project id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'PRJ-0002',
            display_name: 'PRJ-0002',
            project_dir: '/tmp/projects/PRJ-0002',
            has_plan: false,
            run_mode: 'auto',
            agent_profile: 'default',
            contract_version: 1,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ run_mode: 'auto', agent_profile: 'default', contract_version: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))

    useAgentStore.getState().addLog('PRJ-0002', {
      id: 'stale-log',
      timestamp: new Date().toISOString(),
      content: 'stale message',
      type: 'response',
      metadata: {},
    })
    expect(useAgentStore.getState().logsByProject['PRJ-0002']).toHaveLength(1)

    await useProjectStore.getState().createProject({
      projectId: 'PRJ-0002',
      displayName: 'PRJ-0002',
      description: 'new project',
      dataPath: '/tmp/data',
      references: '',
    })

    expect(useProjectStore.getState().selectedTaskId).toBe('PRJ-0002')
    expect(useProjectStore.getState().tasks[0]?.projectDir).toBe('/tmp/projects/PRJ-0002')
    expect(useAgentStore.getState().logsByProject['PRJ-0002']).toBeUndefined()
  })

  it('clears project logs when deleting a task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/projects/PRJ-0001/remove') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ deleted: false, removed: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))
    useAgentStore.getState().addLog('PRJ-0001', {
      id: 'log-to-delete',
      timestamp: new Date().toISOString(),
      content: 'message',
      type: 'response',
      metadata: {},
    })
    expect(useAgentStore.getState().logsByProject['PRJ-0001']).toHaveLength(1)

    await useProjectStore.getState().deleteTask('PRJ-0001', false)

    expect(useAgentStore.getState().logsByProject['PRJ-0001']).toBeUndefined()
  })

  it('keeps project state when local file deletion is not confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/projects?session_id=PRJ-0001') && init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ deleted: false, removed: false, reason: 'not found' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await expect(useProjectStore.getState().deleteTask('PRJ-0001', true)).rejects.toThrow('not found')

    expect(useProjectStore.getState().tasks.map((task) => task.id)).toEqual(['PRJ-0001'])
    expect(useProjectStore.getState().selectedTaskId).toBe('PRJ-0001')
  })

  it('removes project state when local file deletion is confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/projects?session_id=PRJ-0001') && init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ deleted: true, removed: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await expect(useProjectStore.getState().deleteTask('PRJ-0001', true)).resolves.toBe(true)

    expect(useProjectStore.getState().tasks).toEqual([])
    expect(useProjectStore.getState().selectedTaskId).toBeNull()
  })

  it('syncs status for existing projects from remote list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/projects')) {
        return new Response(
          JSON.stringify({
            projects: [{
              id: 'PRJ-0001',
              display_name: 'PRJ-0001',
              status: 'completed',
              title: 'Demo',
              has_plan: true,
              run_mode: 'auto',
              agent_profile: 'research',
              contract_version: 1,
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().loadProjects()
    const task = useProjectStore.getState().tasks.find((t) => t.id === 'PRJ-0001')
    expect(task?.status).toBe('completed')
  })

  it('keeps normal mode unbound from projects when project list syncs', async () => {
    useProjectStore.setState({ appMode: 'normal', selectedTaskId: null, selectedExpId: null })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/projects')) {
        return new Response(
          JSON.stringify({
            projects: [{
              id: 'PRJ-0001',
              display_name: 'PRJ-0001',
              status: 'in_progress',
              title: 'Remote Demo',
              has_plan: false,
              run_mode: 'auto',
              agent_profile: 'research',
              contract_version: 1,
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().loadProjects()

    expect(useProjectStore.getState().appMode).toBe('normal')
    expect(useProjectStore.getState().selectedTaskId).toBeNull()
    expect(useProjectStore.getState().tasks.map((task) => task.id)).toContain('PRJ-0001')
  })

  it('replaces stale project list and refreshes plans after source changes', async () => {
    useProjectStore.setState({
      tasks: [
        {
          id: 'PRJ-0001',
          label: 'PRJ-0001',
          status: 'in_progress',
          title: 'Old Demo',
          coreQuestion: 'old demo',
          runMode: 'auto',
          agentProfile: 'research',
          contractVersion: 1,
          currentExperiment: 'Exp001',
          experiments: [{ id: 'Exp001', title: 'stale exp', status: 'pending' }],
          knowledge: [],
          research: { references: [], notes: [] },
          result: {},
          startedAt: new Date().toISOString(),
        },
        {
          id: 'PRJ-0002',
          label: 'PRJ-0002',
          status: 'in_progress',
          title: 'Should disappear',
          coreQuestion: 'stale project',
          runMode: 'auto',
          agentProfile: 'research',
          contractVersion: 1,
          experiments: [],
          knowledge: [],
          research: { references: [], notes: [] },
          result: {},
          startedAt: new Date().toISOString(),
        },
      ],
      selectedTaskId: 'PRJ-0002',
      selectedExpId: null,
    })

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/projects')) {
        return new Response(
          JSON.stringify({
            projects: [{
              id: 'PRJ-0001',
              display_name: 'PRJ-0001',
              status: 'completed',
              title: 'Fresh Demo',
              has_plan: true,
              run_mode: 'auto',
              agent_profile: 'research',
              contract_version: 1,
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/plan/contract?session_id=PRJ-0001')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/plan?session_id=PRJ-0001')) {
        return new Response(
          JSON.stringify({
            title: 'Fresh Demo',
            status: 'completed',
            experiments: [{ id: 'Exp009', title: 'fresh exp', status: 'completed' }],
            result: { summary: 'fresh result' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().loadProjects({ replaceMissing: true, refreshAll: true })

    const state = useProjectStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]?.id).toBe('PRJ-0001')
    expect(state.tasks[0]?.status).toBe('completed')
    expect(state.tasks[0]?.title).toBe('Fresh Demo')
    expect(state.tasks[0]?.result.summary).toBe('fresh result')
    expect(state.selectedTaskId).toBe('PRJ-0001')
  })

  it('resetWorkspaceState clears project data that is keyed only by project id', () => {
    useProjectStore.setState({
      tasks: [{
        id: 'PRJ-0001',
        label: 'PRJ-0001',
        status: 'in_progress',
        title: 'Old Workspace Project',
        coreQuestion: 'old',
        runMode: 'manual',
        agentProfile: 'research',
        contractVersion: 2,
        currentExperiment: 'Exp001',
        experiments: [{ id: 'Exp001', title: 'stale exp', status: 'running' }],
        knowledge: ['old knowledge'],
        research: { references: [], notes: [] },
        result: {},
        startedAt: '2026-05-06T00:00:00.000Z',
      }],
      selectedTaskId: 'PRJ-0001',
      selectedExpId: 'Exp001',
      activeStage: 'experiment',
      stats: { experiments: 1, completed: 0, failed: 0, running: 1 },
      projectsLoaded: true,
      contractsByTask: {
        'PRJ-0001': {
          profile: 'research',
          contract_version: 2,
          required_completed_fields: [],
          required_falsify_fields: [],
          falsify_keywords: [],
        },
      },
    })

    useProjectStore.getState().resetWorkspaceState()

    expect(useProjectStore.getState().tasks).toEqual([])
    expect(useProjectStore.getState().selectedTaskId).toBeNull()
    expect(useProjectStore.getState().selectedExpId).toBeNull()
    expect(useProjectStore.getState().activeStage).toBe('research')
    expect(useProjectStore.getState().stats).toEqual({
      experiments: 0,
      completed: 0,
      failed: 0,
      running: 0,
    })
    expect(useProjectStore.getState().projectsLoaded).toBe(false)
    expect(useProjectStore.getState().contractsByTask).toEqual({})
  })

  it('keeps an experiment view on background plan refreshes', async () => {
    useProjectStore.setState({ activeStage: 'experiment' })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/plan/contract?session_id=PRJ-0001')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/plan?session_id=PRJ-0001')) {
        return new Response(
          JSON.stringify({
            title: 'Demo',
            status: 'in_progress',
            experiments: [{ id: 'Exp001', title: 'exp', status: 'pending' }],
            plan: {
              phase: 'questions',
              updated_at: '2026-06-08T12:00:00Z',
              questions: [{ id: 'q1', prompt: 'Choose next goal', kind: 'single', options: ['A'] }],
              answers: { q1: 'stale option' },
            },
            result: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().refreshPlan('PRJ-0001')

    const state = useProjectStore.getState()
    expect(state.tasks[0]?.plan?.phase).toBe('questions')
    expect(state.activeStage).toBe('experiment')
  })

  it('enters plan view when a refresh is triggered by an explicit plan event', async () => {
    useProjectStore.setState({ activeStage: 'experiment' })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/plan/contract?session_id=PRJ-0001')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/plan?session_id=PRJ-0001')) {
        return new Response(
          JSON.stringify({
            title: 'Demo',
            status: 'in_progress',
            experiments: [{ id: 'Exp001', title: 'exp', status: 'pending' }],
            plan: {
              phase: 'questions',
              updated_at: '2026-06-08T12:00:00Z',
              questions: [{ id: 'q1', prompt: 'Choose next goal', kind: 'single', options: ['A'] }],
            },
            result: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().refreshPlan('PRJ-0001', { enterPlan: true })

    const state = useProjectStore.getState()
    expect(state.tasks[0]?.plan?.questions[0]?.prompt).toBe('Choose next goal')
    expect(state.tasks[0]?.plan?.updatedAt).toBe('2026-06-08T12:00:00Z')
    expect(state.tasks[0]?.plan?.answers).toEqual({})
    expect(state.activeStage).toBe('plan')
  })

  it('marks task completed when refreshed plan has phase3 result output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/plan/contract?session_id=PRJ-0001')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/plan?session_id=PRJ-0001')) {
        return new Response(
          JSON.stringify({
            title: 'Demo',
            status: 'in_progress',
            experiments: [
              { id: 'Exp001', title: 'done', status: 'completed' },
              { id: 'Exp002', title: 'next', status: 'pending' },
            ],
            result: {
              output_path: 'result/exports/presentation.pdf',
              output_type: 'presentation',
              summary: 'Export generated',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().refreshPlan('PRJ-0001')
    const task = useProjectStore.getState().tasks.find((t) => t.id === 'PRJ-0001')
    expect(task?.status).toBe('completed')
  })

  it('keeps task in progress when only experiments are completed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/plan/contract?session_id=PRJ-0001')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/plan?session_id=PRJ-0001')) {
        return new Response(
          JSON.stringify({
            title: 'Demo',
            status: 'in_progress',
            experiments: [
              { id: 'Exp001', title: 'done', status: 'completed', results: { metrics: { Dice: 0.81 } } },
              { id: 'Exp002', title: 'next', status: 'pending' },
            ],
            result: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))

    await useProjectStore.getState().refreshPlan('PRJ-0001')
    const task = useProjectStore.getState().tasks.find((t) => t.id === 'PRJ-0001')
    expect(task?.status).toBe('in_progress')
  })
})
