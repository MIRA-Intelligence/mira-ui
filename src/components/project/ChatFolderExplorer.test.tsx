import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'
import type { DirectoryListing, FetchDirectoryResult } from '@/services/api'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { ChatFolderExplorer, parentPath } from './ChatFolderExplorer'
import { ResourceExplorer } from './ResourceExplorer'

const HOME = '/home/u'
const WORKSPACE = `${HOME}/.mira/workspace`
const CHATS = `${WORKSPACE}/chats`

function dir(path: string, parent: string | null, names: Array<[string, boolean]>): DirectoryListing {
  return {
    path,
    parent,
    home: HOME,
    truncated: false,
    entries: names.map(([name, isDir]) => ({ name, path: `${path}/${name}`, size: 1, mtime: 1, is_dir: isDir })),
  }
}

function mockFolders(folders: Record<string, DirectoryListing>) {
  return vi.spyOn(api, 'fetchDirectory').mockImplementation(async (path): Promise<FetchDirectoryResult> => (
    folders[path] ? { ok: true, listing: folders[path] } : { ok: false, status: 404, error: 'directory not found' }
  ))
}

describe('ChatFolderExplorer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ language: 'en', workspacePath: WORKSPACE })
    useUiStore.setState({ chatCenterPreviewFile: null })
    useProjectStore.setState({ appMode: 'normal', tasks: [], projectsLoaded: true })
    useChatStore.setState({ activeChatId: 'chat-1' })
    vi.spyOn(api, 'fetchChatWorkdir').mockImplementation(async (chatId) => ({
      path: `${CHATS}/${chatId}`, exists: true, home: HOME,
    }))
  })

  it('opens the selected chat folder in Quick Chat mode', async () => {
    mockFolders({ [`${CHATS}/chat-1`]: dir(`${CHATS}/chat-1`, CHATS, [['plots', true], ['run.py', false]]) })
    render(<ResourceExplorer />)

    expect(await screen.findByText('run.py')).toBeInTheDocument()
    expect(screen.getByText('plots')).toBeInTheDocument()
    expect(screen.getByText('~/.mira/workspace/chats/chat-1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('run.py'))
    expect(useUiStore.getState().chatCenterPreviewFile).toMatchObject({
      name: 'run.py', absolutePath: `${CHATS}/chat-1/run.py`, relativePath: 'run.py',
    })
  })

  it('goes up, opens folders and returns to the chat folder', async () => {
    mockFolders({
      [`${CHATS}/chat-1`]: dir(`${CHATS}/chat-1`, CHATS, [['run.py', false]]),
      [CHATS]: dir(CHATS, WORKSPACE, [['chat-1', true], ['chat-2', true]]),
      [`${CHATS}/chat-2`]: dir(`${CHATS}/chat-2`, CHATS, [['other.csv', false]]),
      [HOME]: dir(HOME, null, [['Documents', true]]),
    })
    render(<ChatFolderExplorer />)
    await screen.findByText('run.py')
    expect(screen.queryByRole('button', { name: "Back to this chat's folder" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Up one folder' }))
    fireEvent.doubleClick(await screen.findByText('chat-2'))
    expect(await screen.findByText('other.csv')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: "Back to this chat's folder" }))
    expect(await screen.findByText('run.py')).toBeInTheDocument()
  })

  it('cannot go above the folder the engine marks as the top', async () => {
    useChatStore.setState({ activeChatId: null })
    useSettingsStore.setState({ workspacePath: HOME })
    mockFolders({ [HOME]: dir(HOME, null, [['Documents', true]]) })
    render(<ChatFolderExplorer />)
    await screen.findByText('Documents')
    expect(screen.getByRole('button', { name: 'Up one folder' })).toBeDisabled()
  })

  it('expands subfolders in place and filters loaded names', async () => {
    const fetchDirectory = mockFolders({
      [`${CHATS}/chat-1`]: dir(`${CHATS}/chat-1`, CHATS, [['plots', true], ['run.py', false]]),
      [`${CHATS}/chat-1/plots`]: dir(`${CHATS}/chat-1/plots`, `${CHATS}/chat-1`, [['roc.png', false]]),
    })
    render(<ChatFolderExplorer />)
    fireEvent.click(await screen.findByText('plots'))
    expect(await screen.findByText('roc.png')).toBeInTheDocument()
    expect(fetchDirectory).toHaveBeenCalledWith(`${CHATS}/chat-1/plots`)

    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'roc' } })
    expect(screen.getByText('roc.png')).toBeInTheDocument()
    expect(screen.queryByText('run.py')).not.toBeInTheDocument()
  })

  it('says a new chat has no files yet and can still go up', async () => {
    mockFolders({ [CHATS]: dir(CHATS, WORKSPACE, [['chat-0', true]]) })
    vi.mocked(api.fetchChatWorkdir).mockResolvedValue({ path: `${CHATS}/chat-1`, exists: false, home: HOME })
    render(<ChatFolderExplorer />)
    expect(await screen.findByText(/No files in this chat yet/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Up one folder' }))
    expect(await screen.findByText('chat-0')).toBeInTheDocument()
  })

  it('closes a preview from another chat but keeps it across reloads of the same chat', async () => {
    mockFolders({
      [`${CHATS}/chat-1`]: dir(`${CHATS}/chat-1`, CHATS, [['run.py', false]]),
      [`${CHATS}/chat-2`]: dir(`${CHATS}/chat-2`, CHATS, [['b.py', false]]),
    })
    render(<ChatFolderExplorer />)
    fireEvent.click(await screen.findByText('run.py'))
    act(() => useProjectStore.setState({ tasks: [] }))
    expect(useUiStore.getState().chatCenterPreviewFile).not.toBeNull()

    act(() => useChatStore.setState({ activeChatId: 'chat-2' }))
    expect(await screen.findByText('b.py')).toBeInTheDocument()
    expect(useUiStore.getState().chatCenterPreviewFile).toBeNull()
  })

  it('ignores a slow listing of a folder that is no longer shown', async () => {
    let resolveOld: (value: FetchDirectoryResult) => void = () => {}
    vi.spyOn(api, 'fetchDirectory').mockImplementation((path) => {
      if (path === `${CHATS}/chat-1`) return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve({ ok: true, listing: dir(path, CHATS, [['new.txt', false]]) })
    })
    render(<ChatFolderExplorer />)
    await vi.waitFor(() => expect(api.fetchDirectory).toHaveBeenCalledWith(`${CHATS}/chat-1`))
    act(() => useChatStore.setState({ activeChatId: 'chat-2' }))
    await screen.findByText('new.txt')
    await act(async () => resolveOld({ ok: true, listing: dir(`${CHATS}/chat-1`, CHATS, [['old.txt', false]]) }))
    expect(screen.getByText('new.txt')).toBeInTheDocument()
    expect(screen.queryByText('old.txt')).not.toBeInTheDocument()
  })
})

describe('parentPath', () => {
  it.each([
    ['/home/u/ws/chats/chat-1', '/home/u/ws/chats'],
    ['/home/u/', '/home'],
    ['/home', '/'],
    ['C:\\Users\\u\\ws', 'C:\\Users\\u'],
    ['C:\\Users', 'C:\\'],
    ['relative', null],
  ])('%s -> %s', (path, parent) => {
    expect(parentPath(path)).toBe(parent)
  })
})
