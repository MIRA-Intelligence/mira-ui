import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addKnowledgeSource,
  listKnowledgeBases,
  saveProjectKnowledge,
  searchKnowledgeBase,
  uploadKnowledgeFiles,
} from './knowledge'
import { useSettingsStore } from '@/stores/settingsStore'

const initialSettingsState = useSettingsStore.getState()

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('knowledge service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ apiUrl: 'http://agent.local/api' })
  })

  it('lists bases and encodes search queries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond({ knowledge_bases: [{ id: 'kb_1', name: 'Docs' }] }))
      .mockResolvedValueOnce(respond({ hits: [] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await listKnowledgeBases()).toEqual([{ id: 'kb_1', name: 'Docs' }])
    await searchKnowledgeBase('kb_1', '模型 部署', 5)
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://agent.local/api/knowledge/kb_1/search?q=%E6%A8%A1%E5%9E%8B+%E9%83%A8%E7%BD%B2&top_k=5',
      undefined,
    )
  })

  it('uploads files as multipart under the files field', async () => {
    let body: FormData | null = null
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      body = init?.body as FormData
      return respond({ sources: [{ id: 'src_1' }] }, 202)
    }))
    const sources = await uploadKnowledgeFiles('kb_1', [new File(['x'], 'spec.pdf')])
    expect(sources).toEqual([{ id: 'src_1' }])
    expect((body as FormData | null)?.getAll('files').map((f) => (f as File).name)).toEqual(['spec.pdf'])
  })

  it('surfaces engine error messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ error: 'only https:// git URLs are supported' }, 400)))
    await expect(addKnowledgeSource('kb_1', { type: 'git', url: 'http://x' }))
      .rejects.toThrow('only https:// git URLs are supported')
  })

  it('explains a missing endpoint on older engines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })))
    await expect(listKnowledgeBases()).rejects.toThrow('not supported by this engine version')
  })

  it('saves project attachments with PUT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ knowledge_bases: ['kb_1'] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await saveProjectKnowledge('PRJ 1', ['kb_1'])).toEqual(['kb_1'])
    expect(fetchMock).toHaveBeenCalledWith('http://agent.local/api/projects/PRJ%201/knowledge', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ knowledge_bases: ['kb_1'] }),
    }))
  })
})
