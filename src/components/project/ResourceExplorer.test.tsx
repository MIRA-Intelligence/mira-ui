import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { ResourceExplorer } from './ResourceExplorer'

vi.mock('@/components/artifacts', () => ({ ArtifactPreview: () => null }))

describe('ResourceExplorer file identity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ chatCenterPreviewFile: null })
    useProjectStore.setState({
      appMode: 'project', selectedTaskId: 'PRJ-A', tasks: [], projectsLoaded: true,
    })
  })

  it('browses filenames that match Object prototype properties', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: ['constructor/one.txt', '__proto__/two.txt', 'toString/three.txt'].map((path) => ({
        name: path.split('/').pop()!, path, size: 1, mtime: 1, is_dir: false,
      })),
    })
    render(<ResourceExplorer />)
    fireEvent.click(await screen.findByText('constructor'))
    fireEvent.click(screen.getByText('__proto__'))
    fireEvent.click(screen.getByText('toString'))
    expect(screen.getByText('one.txt')).toBeInTheDocument()
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    expect(screen.getByText('three.txt')).toBeInTheDocument()
  })

  it('keeps files selectable without exposing single-file deletion', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: [{ name: 'a.txt', path: 'a.txt', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    fireEvent.click(await screen.findByText('a.txt'))
    expect(screen.getByRole('button', { name: 'Close preview' })).toBeInTheDocument()
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument()
    expect(screen.queryByText('🗑')).not.toBeInTheDocument()
  })

  it('shows matches inside collapsed folders while filtering', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: [{ name: 'metrics.json', path: 'experiments/exp001/metrics.json', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    await screen.findByText('experiments')
    expect(screen.queryByText('metrics.json')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'metrics' } })
    expect(screen.getByText('metrics.json')).toBeInTheDocument()
  })

  it('ignores a slow listing for a project that is no longer selected', async () => {
    let resolveOld: (value: Awaited<ReturnType<typeof api.fetchProjectFilesResult>>) => void = () => {}
    vi.spyOn(api, 'fetchProjectFilesResult').mockImplementation((sessionId) => {
      if (sessionId === 'PRJ-A') return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve({
        ok: true,
        truncated: false,
        files: [{ name: 'new.txt', path: 'new.txt', size: 1, mtime: 1, is_dir: false }],
      })
    })
    render(<ResourceExplorer />)
    act(() => useProjectStore.setState({ selectedTaskId: 'PRJ-B' }))
    await screen.findByText('new.txt')
    await act(async () => resolveOld({
      ok: true,
      truncated: false,
      files: [{ name: 'old.txt', path: 'old.txt', size: 1, mtime: 1, is_dir: false }],
    }))
    expect(screen.getByText('new.txt')).toBeInTheDocument()
    expect(screen.queryByText('old.txt')).not.toBeInTheDocument()
  })

  it('says when the engine truncated the listing', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: true,
      files: [{ name: 'a.txt', path: 'a.txt', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    expect(await screen.findByText(/too many files/)).toBeInTheDocument()
  })

  describe('upload', () => {
    beforeEach(() => {
      vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
        ok: true,
        truncated: false,
        files: [
          { name: 'a.csv', path: 'data/raw/a.csv', size: 1, mtime: 1, is_dir: false },
          { name: 'notes.md', path: 'notes.md', size: 1, mtime: 1, is_dir: false },
        ],
      })
    })

    function upload(container: HTMLElement) {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['x'], 'b.csv')] } })
    }

    it('has one upload button and uploads to the project root by default', async () => {
      const send = vi.spyOn(api, 'uploadProjectFiles').mockResolvedValue({ uploaded: [], extracted: [] })
      const { container } = render(<ResourceExplorer />)
      await screen.findByText('data')
      expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
      expect(screen.queryByText('📎')).not.toBeInTheDocument()

      upload(container)
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('PRJ-A', expect.any(Array), ''))
    })

    it('uploads into the selected folder or the selected file\'s folder', async () => {
      const send = vi.spyOn(api, 'uploadProjectFiles').mockResolvedValue({ uploaded: [], extracted: [] })
      const { container } = render(<ResourceExplorer />)
      fireEvent.click(await screen.findByText('data'))
      upload(container)
      await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('PRJ-A', expect.any(Array), 'data'))

      fireEvent.click(screen.getByText('raw'))
      fireEvent.click(screen.getByText('a.csv'))
      fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
      upload(container)
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
      expect(send).toHaveBeenLastCalledWith('PRJ-A', expect.any(Array), 'data/raw')

      fireEvent.click(screen.getByText('notes.md'))
      upload(container)
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3))
      expect(send).toHaveBeenLastCalledWith('PRJ-A', expect.any(Array), '')
    })
  })
})
