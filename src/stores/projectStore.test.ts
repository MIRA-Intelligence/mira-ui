import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from './projectStore'

const initialState = useProjectStore.getState()

describe('projectStore runtime preferences', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useProjectStore.setState(initialState, true)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ run_mode: 'auto', agent_profile: 'default' }),
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
        agentProfile: 'default',
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
      agentProfile: 'default',
    })
  })

  it('stores profile and mode on selected project task', () => {
    const store = useProjectStore.getState()
    store.setAgentProfile('research')
    store.setMode('manual')

    const task = useProjectStore.getState().tasks.find((t) => t.id === 'PRJ-0001')
    expect(task?.agentProfile).toBe('research')
    expect(task?.runMode).toBe('manual')
    expect(useProjectStore.getState().agentProfile).toBe('research')
    expect(useProjectStore.getState().mode).toBe('manual')
  })
})
