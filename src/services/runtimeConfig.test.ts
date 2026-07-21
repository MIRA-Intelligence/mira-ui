import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchProviderModels,
  fetchRuntimeConfig,
  saveProvidersConfig,
  saveRuntimeConfig,
  testProvider,
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
        auto_max_rounds: 100,
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
            auto_max_rounds: 100,
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

  it('fetchProviderModels GETs the provider models endpoint and normalizes the result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ provider: 'deepseek', api_base: 'https://x', models: ['a', 'b'], cached: true }))
    const out = await fetchProviderModels('deepseek', { apiUrl: API })
    expect(fetchMock).toHaveBeenCalledWith(`${API}/providers/deepseek/models`)
    expect(out).toEqual({ provider: 'deepseek', api_base: 'https://x', models: ['a', 'b'], cached: true })
  })

  it('fetchProviderModels appends refresh=1 when requested', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    await fetchProviderModels('openai', { refresh: true, apiUrl: API })
    expect(fetchMock).toHaveBeenCalledWith(`${API}/providers/openai/models?refresh=1`)
  })

  it('fetchProviderModels throws the JSON error on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad key' }, false, 502))
    await expect(fetchProviderModels('deepseek', { apiUrl: API })).rejects.toThrow('bad key')
  })

  it('testProvider POSTs credentials and returns the parsed result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, message: 'good', model_count: 3 }))
    const out = await testProvider('deepseek', { api_key: 'sk', api_base: null }, API)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/providers/deepseek/test`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ api_key: 'sk', api_base: null })
    expect(out).toEqual({ ok: true, message: 'good', model_count: 3 })
  })

  it('testProvider returns ok:false bodies without throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, message: 'unauthorized' }))
    const out = await testProvider('deepseek', {}, API)
    expect(out).toEqual({ ok: false, message: 'unauthorized', model_count: undefined })
  })

  it('saveProvidersConfig POSTs provider + runtime updates to /config', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ persisted: true }))
    await saveProvidersConfig(
      {
        runtime: { provider: 'deepseek', model: 'deepseek/deepseek-chat' },
        providers: { deepseek: { api_key: 'sk', api_base: null, models: ['deepseek/deepseek-chat'] } },
      },
      API,
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/config`)
    expect(JSON.parse(init.body)).toMatchObject({
      runtime: { provider: 'deepseek' },
      providers: { deepseek: { models: ['deepseek/deepseek-chat'] } },
    })
  })
})
