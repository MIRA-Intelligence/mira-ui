import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { ChatMainPlaceholder } from './ChatMainPlaceholder'

vi.mock('@/components/artifacts', () => ({ ArtifactPreview: () => null }))

const FOLDER = '/home/u/.mira/workspace/chats/chat-1'

describe('ChatMainPlaceholder home page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ chatCenterPreviewFile: null, agentDraftPrompt: null, chatFilesRevision: 0 })
    useProjectStore.setState({ appMode: 'normal', tasks: [] })
    useChatStore.setState({ activeChatId: 'chat-1', chats: [
      { id: 'chat-1', title: '', createdAt: 1, updatedAt: 5 },
      { id: 'old', title: 'MRI segmentation', createdAt: 1, updatedAt: 3 },
      { id: 'older', title: 'Dataset cleanup', createdAt: 1, updatedAt: 2 },
      { id: 'empty', title: '', createdAt: 1, updatedAt: 4 },
    ] })
    vi.spyOn(api, 'fetchChatWorkdir').mockResolvedValue({ path: FOLDER, exists: true, home: '/home/u' })
    vi.spyOn(api, 'fetchDirectory').mockResolvedValue({ ok: true, listing: {
      path: FOLDER, parent: null, home: '/home/u', truncated: false, entries: [
        { name: 'old.csv', path: `${FOLDER}/old.csv`, size: 1, mtime: 1, is_dir: false },
        { name: 'plots', path: `${FOLDER}/plots`, size: 0, mtime: 9, is_dir: true },
        { name: 'new.nii', path: `${FOLDER}/new.nii`, size: 1, mtime: 5, is_dir: false },
      ],
    } })
  })

  it("lists this chat's newest files and previews one", async () => {
    render(<ChatMainPlaceholder />)
    const names = await screen.findAllByRole('button', { name: /\.(csv|nii)$/ })
    expect(names.map((button) => button.textContent)).toEqual(['new.nii', 'old.csv'])
    fireEvent.click(names[0])
    expect(useUiStore.getState().chatCenterPreviewFile).toMatchObject({ absolutePath: `${FOLDER}/new.nii` })
  })

  it('lists recent chats that have begun and opens one', () => {
    render(<ChatMainPlaceholder />)
    expect(screen.getByText('Recent chats')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /MRI segmentation|Dataset cleanup/ }).map((b) => b.textContent))
      .toEqual(['MRI segmentation', 'Dataset cleanup'])
    fireEvent.click(screen.getByRole('button', { name: 'MRI segmentation' }))
    expect(useChatStore.getState().activeChatId).toBe('old')
  })

  it('uploads into the chat folder and suggests analysing the files', async () => {
    const upload = vi.spyOn(api, 'uploadToFolder').mockResolvedValue([
      { name: 'scan.nii', path: `${FOLDER}/scan.nii`, size: 3 },
    ])
    const { container } = render(<ChatMainPlaceholder />)
    expect(screen.getByText('Upload data to analyze')).toBeInTheDocument()
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['nii'], 'scan.nii')] },
    })
    await waitFor(() => expect(upload).toHaveBeenCalledWith(FOLDER, expect.any(Array)))
    await waitFor(() => expect(useUiStore.getState().agentDraftPrompt)
      .toBe('Please analyze the files I just uploaded: scan.nii'))
    expect(useUiStore.getState().chatFilesRevision).toBe(1)
  })

  it('starts a chat first when uploading with none selected', async () => {
    useChatStore.setState({ activeChatId: null })
    const upload = vi.spyOn(api, 'uploadToFolder').mockResolvedValue([])
    const { container } = render(<ChatMainPlaceholder />)
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'a.csv')] },
    })
    await waitFor(() => expect(upload).toHaveBeenCalled())
    const created = useChatStore.getState().activeChatId
    expect(created).toMatch(/^chat-/)
    expect(api.fetchChatWorkdir).toHaveBeenCalledWith(created)
  })
})
