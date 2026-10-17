import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/knowledge', () => ({
  fetchProjectKnowledge: vi.fn(),
  listKnowledgeBases: vi.fn(),
  saveProjectKnowledge: vi.fn(),
}))

import { KnowledgePicker } from './KnowledgePicker'
import { fetchProjectKnowledge, listKnowledgeBases, saveProjectKnowledge } from '@/services/knowledge'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { useUiStore } from '@/stores/uiStore'
import { installLocalStorage } from '@/test/localStorage'

const initialKnowledge = useKnowledgeStore.getState()

const BASES = [
  { id: 'kb_a', name: 'Specs', description: '', created_at: '', updated_at: '', sources: 1, documents: 1, chunks: 4 },
  { id: 'kb_b', name: 'Code', description: '', created_at: '', updated_at: '', sources: 2, documents: 9, chunks: 30 },
]

describe('KnowledgePicker', () => {
  beforeEach(() => {
    installLocalStorage()
    useKnowledgeStore.setState({ ...initialKnowledge, bases: [], loaded: false, chatBases: {}, projectBases: {} }, true)
    vi.mocked(listKnowledgeBases).mockResolvedValue(BASES)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves the project attachment when toggled', async () => {
    vi.mocked(fetchProjectKnowledge).mockResolvedValue(['kb_a'])
    vi.mocked(saveProjectKnowledge).mockImplementation(async (_p, ids) => ids)
    render(<KnowledgePicker sessionId="PRJ-1" scope="project" lang="en" />)

    const button = screen.getByRole('button', { name: 'Knowledge' })
    await waitFor(() => expect(button).toHaveTextContent('1'))
    fireEvent.click(button)
    expect(screen.getByText('Attached to this project')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('checkbox', { name: /Code/ }))
    await waitFor(() => expect(saveProjectKnowledge).toHaveBeenCalledWith('PRJ-1', ['kb_a', 'kb_b']))
    expect(useKnowledgeStore.getState().projectBases['PRJ-1']).toEqual(['kb_a', 'kb_b'])
  })

  it('remembers the selection per chat without calling the engine', async () => {
    render(<KnowledgePicker sessionId="chat-1" scope="chat" lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Specs/ }))
    expect(useKnowledgeStore.getState().chatBases['chat-1']).toEqual(['kb_a'])
    expect(saveProjectKnowledge).not.toHaveBeenCalled()
    expect(fetchProjectKnowledge).not.toHaveBeenCalled()
  })

  it('links to the management page', async () => {
    useUiStore.setState({ knowledgeOpen: false })
    render(<KnowledgePicker sessionId="chat-1" scope="chat" lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage knowledge bases...' }))
    expect(useUiStore.getState().knowledgeOpen).toBe(true)
  })
})
