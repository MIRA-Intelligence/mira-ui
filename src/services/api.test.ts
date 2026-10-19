import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteProject, fetchActiveTurns, fetchProjectFilesResult, fetchSkillHistory, getArtifactDownloadUrl, uploadProjectFiles } from './api'
import { useSettingsStore } from '@/stores/settingsStore'

const initialSettingsState = useSettingsStore.getState()

describe('artifact downloads', () => {
  it('requests an attachment from a cross-origin engine while preserving path and authentication', () => {
    const url = getArtifactDownloadUrl('http://127.0.0.1:18791/api/projects/a/artifacts?path=data%2F%E6%B5%8B%E8%AF%95.txt&token=a%2Bb')
    const parsed = new URL(url)
    expect(parsed.origin).toBe('http://127.0.0.1:18791')
    expect(parsed.searchParams.get('path')).toBe('data/测试.txt')
    expect(parsed.searchParams.get('token')).toBe('a+b')
    expect(parsed.searchParams.get('download')).toBe('1')
    expect(getArtifactDownloadUrl(url)).toBe(url)
  })
})

describe('fetchSkillHistory', () => {
  it('encodes the session and forwards the pagination cursor', async () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual', apiUrl: 'http://agent.local/api' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], next_cursor: null })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchSkillHistory('chat:a/b', 12)).toEqual({ events: [], next_cursor: null })
    expect(fetchMock).toHaveBeenCalledWith('http://agent.local/api/sessions/chat%3Aa%2Fb/skills?cursor=12')
  })

  describe('fetchProjectFilesResult', () => {
    it('returns normalized file rows on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        JSON.stringify({
          files: [
            { name: 'a.csv', path: 'data/a.csv', size: 12, mtime: 1_700_000_000, is_dir: false },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )))

      const result = await fetchProjectFilesResult('PRJ-0001')
      expect(result).toEqual({
        ok: true,
        files: [{
          name: 'a.csv',
          path: 'data/a.csv',
          size: 12,
          mtime: 1_700_000_000,
          is_dir: false,
        }],
        truncated: false,
      })
    })

    it('surfaces HTTP errors instead of pretending the folder is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        '405: Method Not Allowed',
        { status: 405 },
      )))

      const result = await fetchProjectFilesResult('PRJ-0001')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(405)
    })
  })
})

describe('uploadProjectFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ deploymentMode: 'remoteManual', apiUrl: 'http://agent.local/api' })
  })

  it('preserves folder-relative paths from directory uploads', async () => {
    let captured: FormData | null = null
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.body as FormData
      return new Response(JSON.stringify({ uploaded: [], extracted: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const file = new File(['a,b\n'], 'a.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'dataset/tables/a.csv',
      configurable: true,
    })

    await uploadProjectFiles('PRJ-0001', [file], 'data')

    expect(captured).not.toBeNull()
    const formData = captured as unknown as FormData
    const uploaded = formData.get('files') as File
    expect(uploaded.name).toBe('dataset/tables/a.csv')
  })
})

describe('deleteProject', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ deploymentMode: 'remoteManual', apiUrl: 'http://agent.local/api' })
  })

  it('deletes local project files through the existing delete endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: true, removed: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteProject('PRJ-0001', { deleteFiles: true })

    expect(result).toEqual({ deleted: true, removed: true, reason: undefined })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://agent.local/api/projects?session_id=PRJ-0001',
      { method: 'DELETE' },
    )
  })

  it('removes a project from UI through the registry-only endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: false, removed: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteProject('PRJ-0001', { deleteFiles: false })

    expect(result).toEqual({ deleted: false, removed: true, reason: undefined })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://agent.local/api/projects/PRJ-0001/remove',
      { method: 'POST' },
    )
  })

  it('throws when the engine reports files were not deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: false, removed: false, reason: 'not found' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(deleteProject('PRJ-NOPE', { deleteFiles: true })).rejects.toThrow('not found')
  })
})

describe('fetchActiveTurns', () => {
  beforeEach(() => {
    useSettingsStore.setState({ apiUrl: 'http://127.0.0.1:18790/api' })
  })

  it('returns the running turns with their workflow runs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      session_id: 'PRJ-1',
      active: [
        { turn_id: 't1', workflow_run_id: 'run-1', started_at: 1 },
        { turn_id: 't2', workflow_run_id: null },
        { workflow_run_id: 'no-id' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchActiveTurns('PRJ-1')).resolves.toEqual([
      { turn_id: 't1', workflow_run_id: 'run-1' },
      { turn_id: 't2', workflow_run_id: null },
    ])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18790/api/sessions/PRJ-1/turns')
  })

  it('returns null when the engine has no turns endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })))
    await expect(fetchActiveTurns('PRJ-1')).resolves.toBeNull()
  })
})
