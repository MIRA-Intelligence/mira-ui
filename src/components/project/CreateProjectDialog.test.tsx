import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDirectoryExistsError } from '@/services/api'
import { CreateProjectDialog } from './CreateProjectDialog'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { RuntimeConfigPayload } from '@/services/runtimeConfig'

const initialProjects = useProjectStore.getState()
const initialSettings = useSettingsStore.getState()

describe('CreateProjectDialog', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjects, true)
    useSettingsStore.setState(initialSettings, true)
    useSettingsStore.setState({ language: 'en', workspacePath: '/projects', runtimeConfig: null, deploymentMode: 'remoteManual' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined })
  })

  afterEach(() => vi.restoreAllMocks())

  it('cancels without creating a project and focuses the name', () => {
    const create = vi.fn()
    const close = vi.fn()
    useProjectStore.setState({ createProjectShell: create })
    render(<CreateProjectDialog onClose={close} />)
    expect(screen.getByLabelText('Project Name')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it('allows Escape to cancel and keeps keyboard focus inside the dialog', () => {
    const close = vi.fn()
    render(<CreateProjectDialog onClose={close} />)
    fireEvent.keyDown(screen.getByLabelText('Project Name'), { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('uses the server default folder and displays Chinese names in the path', () => {
    render(<CreateProjectDialog onClose={vi.fn()} />)
    act(() => useSettingsStore.setState({ runtimeConfig: {
      project_location: { custom_dir_allowed: true, default_parent_dir: '/server/studies' },
    } as RuntimeConfigPayload }))
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: '肺癌 研究' } })
    expect(screen.getByText('Project directory: /server/studies/肺癌-研究')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Project Location'), { target: { value: '/chosen studies ' } })
    expect(screen.getByLabelText('Project Location')).toHaveValue('/chosen studies ')
    act(() => useSettingsStore.setState({ workspacePath: '/other' }))
    expect(screen.getByLabelText('Project Location')).toHaveValue('/chosen studies ')
    fireEvent.change(screen.getByLabelText('Project Location'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Create Project' })).toBeDisabled()
  })

  it('browses local directories and previews Windows paths', async () => {
    useSettingsStore.setState({ deploymentMode: 'localBundle' })
    const selectDirectory = vi.fn().mockResolvedValue('C:\\Research Data')
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { selectDirectory } })
    render(<CreateProjectDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Lung Study' } })
    fireEvent.click(screen.getByRole('button', { name: 'Browse Folder' }))
    await waitFor(() => expect(screen.getByLabelText('Project Location')).toHaveValue('C:\\Research Data'))
    expect(screen.getByText('Project directory: C:\\Research Data\\lung-study')).toBeInTheDocument()
  })

  it('does not offer the local picker for a remote engine', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { selectDirectory: vi.fn() } })
    render(<CreateProjectDialog onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Browse Folder' })).not.toBeInTheDocument()
  })

  it('shows the managed path and omits a custom directory from creation', async () => {
    useSettingsStore.setState({ runtimeConfig: {
      project_location: { custom_dir_allowed: false, default_parent_dir: '/managed' },
    } as RuntimeConfigPayload })
    const create = vi.fn().mockResolvedValue('study')
    useProjectStore.setState({ createProjectShell: create })
    const close = vi.fn()
    render(<CreateProjectDialog onClose={close} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Study' } })
    expect(screen.getByLabelText('Project Location')).toHaveAttribute('readonly')
    expect(screen.getByText('Project directory: /managed/study')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith('Study', { projectId: 'study', projectParentDir: undefined })
  })

  it('keeps edits on errors and prevents duplicate creation while pending', async () => {
    let rejectCreate!: (error: Error) => void
    const create = vi.fn().mockImplementation(() => new Promise((_, reject) => { rejectCreate = reject }))
    useProjectStore.setState({ createProjectShell: create })
    const close = vi.fn()
    render(<CreateProjectDialog onClose={close} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Study' } })
    fireEvent.submit(screen.getByRole('dialog'))
    fireEvent.submit(screen.getByRole('dialog'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(create).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => rejectCreate(new Error('project directory is not empty')))
    expect(screen.getByRole('alert')).toHaveTextContent('project directory is not empty')
    expect(screen.getByLabelText('Project Name')).toHaveValue('Study')
    expect(screen.getByRole('button', { name: 'Create Project' })).toBeEnabled()
  })
  it('warns on an existing directory and only reuses it on the next explicit click', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new ProjectDirectoryExistsError('/projects/study'))
      .mockResolvedValueOnce('study')
    const close = vi.fn()
    useProjectStore.setState({ createProjectShell: create })
    render(<CreateProjectDialog onClose={close} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Study' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists: /projects/study')
    expect(screen.getByRole('alert')).toHaveTextContent('keep its existing files')
    expect(create).toHaveBeenCalledExactlyOnceWith('Study', { projectId: 'study', projectParentDir: '/projects' })
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create in Existing Directory' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(create).toHaveBeenLastCalledWith('Study', {
      projectId: 'study', projectParentDir: '/projects', allowExistingDir: true,
    })
  })

  it.each(['Project Name', 'Project Location'])('clears reuse confirmation when %s changes', async (field) => {
    const create = vi.fn().mockRejectedValue(new ProjectDirectoryExistsError('/projects/study'))
    useProjectStore.setState({ createProjectShell: create })
    render(<CreateProjectDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Study' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    await screen.findByRole('button', { name: 'Create in Existing Directory' })
    fireEvent.change(screen.getByLabelText(field), { target: { value: field === 'Project Name' ? 'Another' : '/other' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    await screen.findByRole('alert')
    expect(create.mock.calls[1][1]).not.toHaveProperty('allowExistingDir')
  })

  it('lets the user cancel after the existing-directory warning', async () => {
    const create = vi.fn().mockRejectedValue(new ProjectDirectoryExistsError('/projects/study'))
    const close = vi.fn()
    useProjectStore.setState({ createProjectShell: create })
    render(<CreateProjectDialog onClose={close} />)
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Study' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(create).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

})
