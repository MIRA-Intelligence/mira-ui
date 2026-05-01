import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NewProjectModal } from './NewProjectModal'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'

const initialUiState = useUiStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialAgentState = useAgentStore.getState()

describe('NewProjectModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useUiStore.setState(initialUiState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useAgentStore.setState(initialAgentState, true)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ run_mode: 'auto', agent_profile: 'default', contract_version: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    useProjectStore.setState({ projectsLoaded: true })
    useAgentStore.setState({ connected: true })
    useSettingsStore.setState({ language: 'en' })
  })

  it('toggles closed/open without hook-order runtime errors', () => {
    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    expect(screen.queryByText('New Research Project')).not.toBeInTheDocument()

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })
    expect(screen.getByText('New Research Project')).toBeInTheDocument()

    act(() => {
      useUiStore.setState({ newProjectOpen: false })
    })
    expect(screen.queryByText('New Research Project')).not.toBeInTheDocument()
  })

  it('syncs profile and contract selection with project store', () => {
    useProjectStore.setState({
      tasks: [{
        id: 'PRJ-0001',
        label: 'PRJ-0001',
        status: 'in_progress',
        title: 'Demo',
        coreQuestion: 'demo',
        runMode: 'auto',
        agentProfile: 'default',
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
      agentProfile: 'default',
      contractVersion: 1,
    })

    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    fireEvent.click(screen.getByRole('button', { name: 'Strict' }))

    const store = useProjectStore.getState()
    expect(store.agentProfile).toBe('research')
    expect(store.contractVersion).toBe(2)
    expect(store.tasks.find((task) => task.id === 'PRJ-0001')?.agentProfile).toBe('research')
    expect(store.tasks.find((task) => task.id === 'PRJ-0001')?.contractVersion).toBe(2)
  })

  it('shows advanced literature source controls with all libraries enabled by default', () => {
    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Advanced Options' }))

    expect(screen.getByRole('checkbox', { name: /Research & Literature/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'PubMed' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Google Scholar' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'arXiv' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Semantic Scholar' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Crossref' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Europe PMC' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: /Research & Literature/ }))

    expect(screen.getByRole('checkbox', { name: 'PubMed' })).toBeDisabled()
    expect(screen.getByText('External literature search will be skipped. The agent will move directly to planning and experiments.')).toBeInTheDocument()
  })
})
