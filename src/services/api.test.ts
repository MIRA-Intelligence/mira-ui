import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadProjectFiles } from './api'
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
