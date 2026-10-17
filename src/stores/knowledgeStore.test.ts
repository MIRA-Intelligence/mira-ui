import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installLocalStorage } from '@/test/localStorage'

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
  updateKnowledgeBase: vi.fn(),
  uploadKnowledgeFiles: vi.fn(),
}))

import { isIngesting, useKnowledgeStore } from './knowledgeStore'
import {
  deleteKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  saveProjectKnowledge,
  uploadKnowledgeFiles,
} from '@/services/knowledge'

const initial = useKnowledgeStore.getState()

describe('knowledgeStore', () => {
  beforeEach(() => {
    installLocalStorage()
    useKnowledgeStore.setState({ ...initial, chatBases: {}, projectBases: {} }, true)
    vi.mocked(listKnowledgeBases).mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rolls back a project attachment the engine rejects', async () => {
    useKnowledgeStore.setState({ projectBases: { P: ['kb_a'] } })
    vi.mocked(saveProjectKnowledge).mockRejectedValue(new Error('unknown knowledge bases: kb_b'))
    await useKnowledgeStore.getState().setProjectBases('P', ['kb_a', 'kb_b'])
    expect(useKnowledgeStore.getState().projectBases.P).toEqual(['kb_a'])
    expect(useKnowledgeStore.getState().error).toBe('unknown knowledge bases: kb_b')
  })

  it('persists chat selections and drops deleted bases', async () => {
    const store = useKnowledgeStore.getState()
    store.setChatBases('chat-1', ['kb_a', 'kb_b'])
    expect(JSON.parse(localStorage.getItem('mira:knowledge:chatSelections') ?? '{}')).toEqual({ 'chat-1': ['kb_a', 'kb_b'] })

    vi.mocked(deleteKnowledgeBase).mockResolvedValue()
    await useKnowledgeStore.getState().remove('kb_b')
    expect(useKnowledgeStore.getState().chatBases['chat-1']).toEqual(['kb_a'])

    useKnowledgeStore.getState().setChatBases('chat-1', [])
    expect(useKnowledgeStore.getState().chatBases).toEqual({})
  })

  it('reloads the base after an upload', async () => {
    vi.mocked(uploadKnowledgeFiles).mockResolvedValue([])
    const detail = { id: 'kb_a', name: 'A', description: '', created_at: '', updated_at: '', documents: 0, chunks: 0, sources: [] }
    vi.mocked(getKnowledgeBase).mockResolvedValue(detail)
    expect(await useKnowledgeStore.getState().upload('kb_a', [new File(['x'], 'a.md')])).toBe(true)
    expect(useKnowledgeStore.getState().details.kb_a).toEqual(detail)
    expect(listKnowledgeBases).toHaveBeenCalled()
  })

  it('detects sources still being indexed', () => {
    const source = (status: string) => ({ status }) as never
    expect(isIngesting(undefined)).toBe(false)
    expect(isIngesting({ sources: [source('ready'), source('processing')] } as never)).toBe(true)
    expect(isIngesting({ sources: [source('ready'), source('failed')] } as never)).toBe(false)
  })
})
