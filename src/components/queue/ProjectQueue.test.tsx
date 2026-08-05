import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectQueue } from './ProjectQueue'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useOrganizationStore } from '@/stores/organizationStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialUiState = useUiStore.getState()
const initialChatState = useChatStore.getState()
const initialOrganizationState = useOrganizationStore.getState()

describe('ProjectQueue mode switch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useUiStore.setState(initialUiState, true)
    useChatStore.setState(initialChatState, true)
    useOrganizationStore.setState(initialOrganizationState, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('hides manual and auto controls in normal mode', () => {
    useProjectStore.setState({ appMode: 'normal', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument()
  })

  it('shows manual and auto controls in project mode', () => {
    useProjectStore.setState({ appMode: 'project', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.getByRole('button', { name: 'Manual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument()
  })

  it('groups chats in shared folders and filters by title', () => {
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({
      workspaceKey: 'ws',
      chats: [
        { id: 'chat-lung', title: 'Lung cancer staging', createdAt: 1, updatedAt: 2 },
        { id: 'chat-brain', title: 'Glioma imaging', createdAt: 1, updatedAt: 1 },
      ],
      activeChatId: 'chat-lung',
    })
    useOrganizationStore.setState({
      folders: [{ id: 'folder-lung', name: 'Lung cancer', created_at: 'x', updated_at: 'x' }],
      assignments: { chat: { 'chat-lung': 'folder-lung' }, project: {} },
    })

    render(<ProjectQueue />)

    expect(screen.getByText('Lung cancer')).toBeInTheDocument()
    expect(screen.getByText('Uncategorized')).toBeInTheDocument()
    const search = screen.getByPlaceholderText('Search folders and titles...')
    fireEvent.change(search, { target: { value: 'Glioma' } })
    expect(screen.queryByText('Lung cancer staging')).not.toBeInTheDocument()
    expect(screen.getByText('Glioma imaging')).toBeInTheDocument()
  })

  it('moves a dragged chat into a folder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })))
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({
      workspaceKey: 'ws',
      chats: [{ id: 'chat-1', title: 'Question', createdAt: 1, updatedAt: 1 }],
      activeChatId: 'chat-1',
    })
    useOrganizationStore.setState({
      loaded: true,
      folders: [{ id: 'folder-1', name: 'Topic', created_at: 'x', updated_at: 'x' }],
      assignments: { chat: {}, project: {} },
    })
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }

    render(<ProjectQueue />)

    const source = screen.getByText('Question').closest('[draggable="true"]')
    const target = screen.getByText('Topic').closest('div')
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    fireEvent.dragStart(source!, { dataTransfer })
    fireEvent.drop(target!, { dataTransfer })

    await waitFor(() => {
      expect(useOrganizationStore.getState().assignments.chat['chat-1']).toBe('folder-1')
    })
    vi.unstubAllGlobals()
  })
})
