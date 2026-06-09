import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteProject, uploadProjectFiles } from './api'
import { useSettingsStore } from '@/stores/settingsStore'

const initialSettingsState = useSettingsStore.getState()

describe('uploadProjectFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ apiUrl: 'http://agent.local/api' })
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
    useSettingsStore.setState({ apiUrl: 'http://agent.local/api' })
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
