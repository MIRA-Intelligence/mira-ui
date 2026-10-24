import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const collapseKey = 'mira:organization:collapsed:batch:chats'

describe('ProjectQueue explicit selection', () => {
  // Isolate persisted folder state between the Ctrl and Cmd regression cases.
  afterEach(() => localStorage?.removeItem(collapseKey))
  beforeEach(() => {
    localStorage?.removeItem(collapseKey)
    vi.restoreAllMocks()
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useUiStore.setState(initialUiState, true)
    useChatStore.setState(initialChatState, true)
    useOrganizationStore.setState(initialOrganizationState, true)
    useChatStore.setState({ chats: [], activeChatId: null, workspaceKey: 'test' })
    useSettingsStore.setState({ language: 'en' })
  })

  function seedBatchChats() {
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({ workspaceKey: 'batch', activeChatId: 'a', chats: [
      { id: 'b', title: 'Batch B', createdAt: 1, updatedAt: 2 },
      { id: 'c', title: 'Batch C', createdAt: 1, updatedAt: 1 },
      { id: 'a', title: 'Batch A', createdAt: 1, updatedAt: 3 },
    ] })
    useOrganizationStore.setState({ loaded: true, folders: [{ id: 'dest', name: 'Destination', created_at: 'x', updated_at: 'x' }],
      assignments: { chat: {}, project: {} } })
  }

  it('opens a chat on plain click without showing bulk selection', () => {
    seedBatchChats()
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }))
    expect(useChatStore.getState().activeChatId).toBe('b')
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch B' })).toHaveAttribute('aria-pressed', 'false')
  })

  it.each(['ctrlKey', 'metaKey'] as const)('uses %s to extend navigation into a non-contiguous selection', (modifier) => {
    seedBatchChats()
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { [modifier]: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch B' })).toHaveAttribute('aria-pressed', 'false')
    expect(useChatStore.getState().activeChatId).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { [modifier]: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch A' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Batch A' }), { [modifier]: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
  })

  it.each(['ctrlKey', 'metaKey', 'shiftKey'] as const)('does not show bulk mode for a singleton %s selection', (modifier) => {
    seedBatchChats()
    useChatStore.setState({ activeChatId: null })
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { [modifier]: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch B' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clears the batch selection on plain navigation', () => {
    seedBatchChats()
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { shiftKey: true })
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }))
    expect(useChatStore.getState().activeChatId).toBe('b')
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    for (const title of ['Batch A', 'Batch B', 'Batch C']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'false')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { ctrlKey: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch A' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('preserves toggle membership after deselecting the active chat', () => {
    seedBatchChats()
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Batch A' }), { ctrlKey: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { ctrlKey: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch A' })).toHaveAttribute('aria-pressed', 'false')
    for (const title of ['Batch B', 'Batch C']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('uses the last clicked row as the Shift anchor after deselection', () => {
    seedBatchChats()
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Batch A' }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { shiftKey: true })
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    for (const title of ['Batch A', 'Batch B', 'Batch C']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('extends a singleton toggle when no conversation is active', () => {
    seedBatchChats()
    useChatStore.setState({ activeChatId: null })
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { ctrlKey: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { ctrlKey: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch A' })).toHaveAttribute('aria-pressed', 'false')
    expect(useChatStore.getState().activeChatId).toBeNull()
  })

  it.each(['ctrlKey', 'metaKey'] as const)('does not seed a hidden active chat with %s', (modifier) => {
    seedBatchChats()
    const { unmount } = render(<ProjectQueue />)
    fireEvent.change(screen.getByPlaceholderText('Search folders and titles...'), { target: { value: 'Batch B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { [modifier]: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    unmount()
    seedBatchChats()
    useOrganizationStore.setState({ assignments: { chat: { a: 'dest' }, project: {} } })
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: /Destination/ }))
    expect(screen.queryByRole('button', { name: 'Batch A' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch B' }), { [modifier]: true })
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { [modifier]: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    for (const title of ['Batch B', 'Batch C']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('extends only the failed selection after a partially successful move', async () => {
    seedBatchChats()
    vi.spyOn(useOrganizationStore.getState(), 'moveItem').mockImplementation(async (_kind, id) => {
      if (id === 'b') throw new Error('offline')
    })
    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { shiftKey: true })
    fireEvent.change(screen.getByRole('combobox', { name: 'Move selected conversations' }), { target: { value: 'dest' } })
    await waitFor(() => expect(useUiStore.getState().systemMessages.at(-1)?.text).toContain('1 failed'))
    expect(screen.queryByLabelText('Conversation bulk actions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Batch C' }), { ctrlKey: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Batch A' })).toHaveAttribute('aria-pressed', 'false')
    for (const title of ['Batch B', 'Batch C']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'true')
    }
  })

})
