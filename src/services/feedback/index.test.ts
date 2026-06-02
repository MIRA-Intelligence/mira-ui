import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearQueue, queueLength } from './queue'
import { submitFeedback } from './index'

function installLocalStorageStub() {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key)
    }),
  })
}

describe('feedback service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    installLocalStorageStub()
    clearQueue()
  })

  it('does not queue feedback when backend relay is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({ error: 'not_found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await submitFeedback({
      type: 'feature',
      severity: null,
      title: 'Add file manager',
      body: 'Show workspace files as a tree.',
      contact: null,
      route: '/',
      locale: 'zh',
    })

    expect(outcome).toEqual({
      ok: false,
      channel: null,
      error: 'not_configured',
      queued: false,
    })
    expect(queueLength()).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/feedback/config')
  })
})
