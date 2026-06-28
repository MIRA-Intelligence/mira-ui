import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchRuntimeConfig,
  saveRuntimeConfig,
  updateProjectsRoot,
} from './runtimeConfig'

const API = 'http://test.local'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

const fetchMock = vi.fn()

describe('runtimeConfig service', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchRuntimeConfig GETs /config and returns the payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ projects_root: '/p' }))
    const out = await fetchRuntimeConfig(API)
    expect(fetchMock).toHaveBeenCalledWith(`${API}/config`)
    expect(out).toEqual({ projects_root: '/p' })
  })

  it('fetchRuntimeConfig throws the response text on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('boom', false, 500))
    await expect(fetchRuntimeConfig(API)).rejects.toThrow('boom')
  })

  it('saveRuntimeConfig POSTs the runtime payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ persisted: true }))
    const payload = {
      runtime: {
        provider: 'openai',
        model: 'gpt',
        reasoning_effort: null,
        temperature: 0.5,
        max_tool_iterations: 10,
        restrict_to_workspace: false,
      },
      providers: {},
    }
    const out = await saveRuntimeConfig(payload, API)
    expect(out).toEqual({ persisted: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/config`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ runtime: { provider: 'openai' } })
  })

  it('saveRuntimeConfig surfaces the JSON error field on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad provider' }, false, 400))
    await expect(
      saveRuntimeConfig(
        {
          runtime: {
            provider: 'x',
            model: 'm',
            reasoning_effort: null,
            temperature: null,
            max_tool_iterations: 1,
            restrict_to_workspace: true,
          },
          providers: {},
        },
        API,
      ),
    ).rejects.toThrow('bad provider')
  })

  it('updateProjectsRoot POSTs only projects_root', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ projects_root: '/new' }))
    await updateProjectsRoot('/new', API)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ projects_root: '/new' })
  })
})
