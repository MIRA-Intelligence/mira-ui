import { expect, it, vi } from 'vitest'

it('blocks unmocked fetch even after tests restore their own mocks', async () => {
  vi.stubGlobal('fetch', vi.fn())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await expect(fetch('http://127.0.0.1:18790/api/organization')).rejects.toThrow('Network disabled in unit tests')
})
