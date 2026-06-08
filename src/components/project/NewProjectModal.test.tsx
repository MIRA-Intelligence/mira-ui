import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('keeps profile and contract choices local until the project is created', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Engineer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Strict' }))

    const store = useProjectStore.getState()
    expect(store.agentProfile).toBe('research')
    expect(store.contractVersion).toBe(1)
    expect(store.tasks.find((task) => task.id === 'PRJ-0001')?.agentProfile).toBe('research')
    expect(store.tasks.find((task) => task.id === 'PRJ-0001')?.contractVersion).toBe(1)
  })

  it('allows profile selection while another session is streaming', () => {
    useAgentStore.setState({ streamingBySession: { 'PRJ-0001': true } })

    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    const engineer = screen.getByRole('button', { name: 'Engineer' })
    expect(engineer).not.toBeDisabled()
    fireEvent.click(engineer)
    expect(engineer).toHaveClass('text-[var(--color-accent)]')
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
    expect(screen.getByText('External literature search will be skipped. The agent will move directly to interactive planning.')).toBeInTheDocument()
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

  it('deletes the remote project when file upload fails during creation', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'upload-fails',
            display_name: 'Upload Fails',
            project_dir: '/tmp/projects/upload-fails',
            has_plan: false,
            run_mode: 'auto',
            agent_profile: 'default',
            contract_version: 1,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/projects/upload-fails/files') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'upload failed' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/projects?session_id=upload-fails') && init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ deleted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ run_mode: 'auto', agent_profile: 'default', contract_version: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })

    fireEvent.change(screen.getByPlaceholderText('e.g. prefix-ratio-grpo'), {
      target: { value: 'Upload: Fails' },
    })
    fireEvent.change(screen.getByPlaceholderText('Describe your research goal, question, or hypothesis...'), {
      target: { value: 'Verify failed upload rollback.' },
    })
    const dataInput = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(dataInput).not.toBeNull()
    fireEvent.change(dataInput!, {
      target: {
        files: [new File(['sample'], 'sample.csv', { type: 'text/csv' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    expect(await screen.findByText('upload failed')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/projects?session_id=upload-fails'),
        { method: 'DELETE' },
      )
    })
    const createCall = fetchMock.mock.calls.find(([input, init]) => (
      String(input).endsWith('/projects') && init?.method === 'POST'
    ))
    expect(JSON.parse(String(createCall?.[1]?.body)).project_id).toBe('upload-fails')
    expect(useProjectStore.getState().tasks.find((task) => task.id === 'upload-fails')).toBeUndefined()
  })
})
