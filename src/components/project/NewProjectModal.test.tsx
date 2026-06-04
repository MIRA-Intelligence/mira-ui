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
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      configurable: true,
    })
    useUiStore.setState(initialUiState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useAgentStore.setState(initialAgentState, true)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ run_mode: 'auto', agent_profile: 'research', contract_version: 1 }),
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
      agentProfile: 'research',
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

  it('shows path browsing controls in local bundle mode', () => {
    useSettingsStore.setState({ deploymentMode: 'localBundle' })
    Object.defineProperty(window, 'electronAPI', {
      value: { selectDataPath: vi.fn() },
      configurable: true,
    })

    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    expect(screen.getByPlaceholderText('Select or enter a data path visible to the local agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse File Path' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse Folder Path' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload Folder' })).not.toBeInTheDocument()
  })

  it('shows the first uploaded file selection before clearing the file input', () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual' })

    const { container } = render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    const dataInputs = container.querySelectorAll('input[type="file"]')
    const dataFileInput = dataInputs[0] as HTMLInputElement
    const file = new File(['a,b\n'], 'a.csv', { type: 'text/csv' })
    let inputCleared = false
    const fileList = {
      0: file,
      get length() {
        return inputCleared ? 0 : 1
      },
      item(index: number) {
        return index === 0 && !inputCleared ? file : null
      },
    } as unknown as FileList
    Object.defineProperty(dataFileInput, 'value', {
      configurable: true,
      get: () => (inputCleared ? '' : 'C:\\fakepath\\a.csv'),
      set: (value: string) => {
        if (value === '') inputCleared = true
      },
    })

    fireEvent.change(dataFileInput, { target: { files: fileList } })

    expect(screen.getByText('1 file(s) selected, will upload into data/')).toBeInTheDocument()
    expect(screen.getByText('a.csv')).toBeInTheDocument()
  })

  it('shows local upload controls and clears uploads when a remote path is entered', () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual' })

    const { container } = render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    expect(screen.getByPlaceholderText('Enter a remote agent-visible path, or upload local files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload Files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload Folder' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse File Path' })).not.toBeInTheDocument()
    const dataInputs = container.querySelectorAll('input[type="file"]')
    expect(dataInputs[1]).toHaveAttribute('webkitdirectory')
    expect(dataInputs[1]).toHaveAttribute('directory')
    const folderClick = vi.spyOn(dataInputs[1] as HTMLInputElement, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Upload Folder' }))
    expect(folderClick).toHaveBeenCalled()

    const file = new File(['a,b\n'], 'a.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'dataset/tables/a.csv',
      configurable: true,
    })
    const dataFileInput = dataInputs[0] as HTMLInputElement

    fireEvent.change(dataFileInput, { target: { files: [file] } })

    expect(screen.getByText('1 file(s) selected, will upload into data/')).toBeInTheDocument()
    expect(screen.getByText('dataset/tables/a.csv')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Enter a remote agent-visible path, or upload local files'), {
      target: { value: 'datasets/remote' },
    })

    expect(screen.queryByText('1 file(s) selected, will upload into data/')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset/tables/a.csv')).not.toBeInTheDocument()
  })
})
