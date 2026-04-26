import { beforeEach, describe, expect, it, vi } from 'vitest'

import { probeEngineCompatibility } from './engine'

describe('probeEngineCompatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reports setup_required when bundle runtime is still using bootstrap placeholders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.2.0', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'custom',
              model: 'custom/mira-ui-bundle-setup',
            },
            providers: {
              custom: {
                api_key_configured: false,
                api_key_preview: null,
                api_base: 'http://127.0.0.1:9/v1',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }))

    const result = await probeEngineCompatibility('http://127.0.0.1:18790/api')

    expect(result.status).toBe('setup_required')
    expect(result.message).toContain('model access is still unconfigured')
    expect(result.version).toBe('0.2.0')
  })

  it('reports incompatible when runtime config API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.2.0', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response('Method Not Allowed', { status: 405 })
      }
      return new Response('{}', { status: 404 })
    }))

    const result = await probeEngineCompatibility('http://127.0.0.1:18790/api')

    expect(result.status).toBe('incompatible')
    expect(result.message).toContain('runtime config API is unavailable')
  })

  it('reports compatible when health, version, and runtime config all look valid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.2.0', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'openrouter',
              model: 'anthropic/claude-sonnet-4-5',
            },
            providers: {
              openrouter: {
                api_key_configured: true,
                api_key_preview: 'sk-t...ey',
                api_base: 'https://openrouter.ai/api/v1',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }))

    const result = await probeEngineCompatibility('http://127.0.0.1:18790/api')

    expect(result.status).toBe('compatible')
    expect(result.version).toBe('0.2.0')
  })
})
