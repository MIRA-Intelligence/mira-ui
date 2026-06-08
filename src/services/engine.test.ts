import { beforeEach, describe, expect, it, vi } from 'vitest'

import { probeEngineCompatibility } from './engine'
import { useSettingsStore } from '@/stores/settingsStore'

describe('probeEngineCompatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ language: 'en' })
  })

  it('reports setup_required when backend marks runtime setup incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'custom',
              model: 'custom/mira-ui-bundle-setup',
              setup_required: true,
              setup_message: 'Local engine is running, but model access is still unconfigured.',
              setup_code: 'missing_api_base',
              setup_subject: 'Custom',
            },
            providers: {
              custom: {
                api_key_configured: false,
                api_key_preview: null,
                api_base: 'http://127.0.0.1:9/v1',
                display_name: 'Custom',
                api_key_required: false,
                api_base_required: true,
                default_api_base: null,
                is_oauth: false,
                is_local: false,
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
    expect(result.message).toContain('Custom requires API Base')
    expect(result.version).toBe('0.3.2')
  })

  it('reports incompatible when runtime config API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
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
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'openrouter',
              model: 'anthropic/claude-sonnet-4-5',
              setup_required: false,
              setup_message: null,
            },
            providers: {
              openrouter: {
                api_key_configured: true,
                api_key_preview: 'sk-t...ey',
                api_base: 'https://openrouter.ai/api/v1',
                display_name: 'OpenRouter',
                api_key_required: true,
                api_base_required: false,
                default_api_base: 'https://openrouter.ai/api/v1',
                is_oauth: false,
                is_local: false,
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
    expect(result.version).toBe('0.3.2')
  })

  it('treats auto-detect provider as compatible when backend reports setup is complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'auto',
              model: 'claude-sonnet-4-5',
              setup_required: false,
              setup_message: null,
            },
            providers: {
              auto: {
                api_key_configured: false,
                api_key_preview: null,
                api_base: null,
                display_name: 'Auto-detect',
                api_key_required: false,
                api_base_required: false,
                default_api_base: null,
                is_oauth: false,
                is_local: false,
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
    expect(result.version).toBe('0.3.2')
  })

  it('localizes setup_required messages using backend setup codes', async () => {
    useSettingsStore.setState({ language: 'zh' })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'azure_openai',
              model: 'gpt-4.1',
              setup_required: true,
              setup_message: 'Azure OpenAI requires API Base. Open Settings > Local Runtime Config and update the endpoint.',
              setup_code: 'missing_api_base',
              setup_subject: 'Azure OpenAI',
            },
            providers: {
              azure_openai: {
                api_key_configured: true,
                api_key_preview: 'sk-a...ey',
                api_base: null,
                display_name: 'Azure OpenAI',
                api_key_required: true,
                api_base_required: true,
                default_api_base: null,
                is_oauth: false,
                is_local: false,
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
    expect(result.message).toBe('Azure OpenAI 需要配置 API Base。请打开“设置 > 本地运行时配置”补全服务地址。')
  })

  it('uses backend setup status for newer providers outside the old UI whitelist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: {
              provider: 'deepseek',
              model: 'deepseek/deepseek-chat',
              setup_required: false,
              setup_message: null,
            },
            providers: {
              deepseek: {
                api_key_configured: true,
                api_key_preview: 'sk-d...ey',
                api_base: null,
                display_name: 'DeepSeek',
                api_key_required: true,
                api_base_required: false,
                default_api_base: null,
                is_oauth: false,
                is_local: false,
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
    expect(result.version).toBe('0.3.2')
  })

  it('captures uptime_seconds reported by the engine /version endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1', uptime_seconds: 4242 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: { provider: 'auto', model: 'claude-sonnet-4-5', setup_required: false, setup_message: null },
            providers: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }))

    const result = await probeEngineCompatibility('http://127.0.0.1:18790/api')

    expect(result.status).toBe('compatible')
    expect(result.uptimeSeconds).toBe(4242)
  })

  it('reports null uptime when the engine omits uptime_seconds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/version')) {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            runtime: { provider: 'auto', model: 'claude-sonnet-4-5', setup_required: false, setup_message: null },
            providers: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }))

    const result = await probeEngineCompatibility('http://127.0.0.1:18790/api')

    expect(result.status).toBe('compatible')
    expect(result.uptimeSeconds).toBeNull()
  })

  it('probes health and version under /api for Vite dev same-origin proxy', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:5173/api/health') {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'http://127.0.0.1:5173/api/version') {
        return new Response(
          JSON.stringify({ agent_version: '0.3.2', api_contract: 'v1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url === 'http://127.0.0.1:5173/api/config') {
        return new Response(
          JSON.stringify({
            runtime: { provider: 'auto', model: 'claude-sonnet-4-5', setup_required: false, setup_message: null },
            providers: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeEngineCompatibility('http://127.0.0.1:5173/api')

    expect(result.status).toBe('compatible')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5173/api/health')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5173/api/version')
  })
})
