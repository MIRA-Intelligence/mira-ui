import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/knowledge', () => ({
  addKnowledgeSource: vi.fn(),
  createKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
  fetchProjectKnowledge: vi.fn(),
  getKnowledgeBase: vi.fn(),
  listKnowledgeBases: vi.fn(),
  refreshKnowledgeSource: vi.fn(),
  saveProjectKnowledge: vi.fn(),
  searchKnowledgeBase: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  uploadKnowledgeFiles: vi.fn(),
}))

import { KnowledgePage } from './KnowledgePage'
import {
  addKnowledgeSource,
  createKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  searchKnowledgeBase,
  uploadKnowledgeFiles,
  type KnowledgeBaseDetail,
} from '@/services/knowledge'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const initialKnowledge = useKnowledgeStore.getState()
const initialUi = useUiStore.getState()
const initialSettings = useSettingsStore.getState()

function detail(over: Partial<KnowledgeBaseDetail> = {}): KnowledgeBaseDetail {
  return {
    id: 'kb_1',
    name: 'Specs',
    description: 'Product specs',
    created_at: '',
    updated_at: '',
    documents: 2,
    chunks: 9,
    sources: [
      {
        id: 'src_1', kind: 'file', title: 'plan.pdf', origin: 'plan.pdf', status: 'ready', error: '',
        doc_count: 1, chunk_count: 9, meta: {}, created_at: '', updated_at: '',
      },
      {
        id: 'src_2', kind: 'git', title: 'repo', origin: 'https://github.com/o/repo.git', status: 'failed',
        error: 'git clone failed: not found', doc_count: 0, chunk_count: 0, meta: {}, created_at: '', updated_at: '',
      },
    ],
    ...over,
  }
}

describe('KnowledgePage', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({ ...initialKnowledge, bases: [], details: {}, loaded: false, error: null }, true)
    useUiStore.setState({ ...initialUi, knowledgeOpen: true }, true)
    useSettingsStore.setState({ ...initialSettings, language: 'en' }, true)
    vi.mocked(listKnowledgeBases).mockResolvedValue([
      { id: 'kb_1', name: 'Specs', description: 'Product specs', created_at: '', updated_at: '', sources: 2, documents: 2, chunks: 9 },
    ])
    vi.mocked(getKnowledgeBase).mockResolvedValue(detail())
  })

  it('shows sources with status and errors for the selected base', async () => {
    render(<KnowledgePage />)
    expect(await screen.findByText('plan.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('git clone failed: not found')).toBeInTheDocument()
    expect(screen.getByText('1 docs · 9 chunks')).toBeInTheDocument()
  })

  it('adds a web page and uploads files', async () => {
    vi.mocked(addKnowledgeSource).mockResolvedValue([])
    vi.mocked(uploadKnowledgeFiles).mockResolvedValue([])
    render(<KnowledgePage />)
    await screen.findByText('plan.pdf')

    fireEvent.click(screen.getByRole('tab', { name: 'Web page' }))
    fireEvent.change(screen.getByPlaceholderText('https://example.com/docs/page'), { target: { value: 'https://docs.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addKnowledgeSource).toHaveBeenCalledWith('kb_1', { type: 'url', url: 'https://docs.example.com' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    const file = new File(['# hi'], 'notes.md')
    fireEvent.change(screen.getByTestId('knowledge-file-input'), { target: { files: [file] } })
    await waitFor(() => expect(uploadKnowledgeFiles).toHaveBeenCalledWith('kb_1', [file]))
  })

  it('sends the optional git ref', async () => {
    vi.mocked(addKnowledgeSource).mockResolvedValue([])
    render(<KnowledgePage />)
    await screen.findByText('plan.pdf')
    fireEvent.click(screen.getByRole('tab', { name: 'Git repository' }))
    fireEvent.change(screen.getByPlaceholderText('https://github.com/org/repo.git'), { target: { value: 'https://github.com/o/r.git' } })
    fireEvent.change(screen.getByPlaceholderText('Branch or tag (optional)'), { target: { value: 'v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addKnowledgeSource).toHaveBeenCalledWith('kb_1', { type: 'git', url: 'https://github.com/o/r.git', ref: 'v2' }))
  })

  it('runs a test search and shows citations', async () => {
    vi.mocked(searchKnowledgeBase).mockResolvedValue([{
      kb_id: 'kb_1', kb_name: 'Specs', source_id: 'src_1', source_title: 'plan.pdf', doc_id: 'doc_1', path: 'plan.pdf',
      url: '', start_line: 3, end_line: 5, page: 2, heading: 'Latency', text: 'Budget is 40 ms', score: 3.2,
      citation: '[Specs/plan.pdf#p.2]',
    }])
    render(<KnowledgePage />)
    await screen.findByText('plan.pdf')
    fireEvent.change(screen.getByPlaceholderText('Search this knowledge base...'), { target: { value: 'latency' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('[Specs/plan.pdf#p.2]')).toBeInTheDocument()
    expect(screen.getByText('Budget is 40 ms')).toBeInTheDocument()
    expect(searchKnowledgeBase).toHaveBeenCalledWith('kb_1', 'latency')
  })

  it('starts with the create form when there are no bases', async () => {
    vi.mocked(listKnowledgeBases).mockResolvedValue([])
    vi.mocked(createKnowledgeBase).mockResolvedValue(detail({ id: 'kb_new', name: 'New', sources: [] }))
    render(<KnowledgePage />)
    const name = await screen.findByPlaceholderText('e.g. Product specs')
    fireEvent.change(name, { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createKnowledgeBase).toHaveBeenCalledWith('New', ''))
  })

  it('shows engine errors and closes', async () => {
    vi.mocked(listKnowledgeBases).mockRejectedValue(new Error('Knowledge bases are not supported by this engine version.'))
    render(<KnowledgePage />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/not supported/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(useUiStore.getState().knowledgeOpen).toBe(false)
  })
})
