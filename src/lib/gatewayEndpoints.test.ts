import { afterEach, describe, expect, it } from 'vitest'
import { resolveApiUrl, resolveWsUrl } from './gatewayEndpoints'

afterEach(() => { delete window.electronAPI })

describe('gateway endpoints', () => {
  it('preserves a remote gateway in browser development', () => {
    expect(resolveApiUrl({ deploymentMode: 'remoteManual', apiUrl: 'https://engine.example/api/' }))
      .toBe('https://engine.example/api')
    expect(resolveWsUrl({ deploymentMode: 'remoteManual', wsUrl: 'wss://engine.example/ws' }))
      .toBe('wss://engine.example/ws')
  })

  it('uses the bundled gateway in desktop mode', () => {
    window.electronAPI = { platform: 'linux' }
    expect(resolveApiUrl({ deploymentMode: 'localBundle', apiUrl: 'https://engine.example/api' }))
      .toBe('http://127.0.0.1:18790/api')
    expect(resolveWsUrl({ deploymentMode: 'localBundle', wsUrl: 'wss://engine.example/ws' }))
      .toBe('ws://127.0.0.1:18790/ws')
  })

  it('supports an explicitly configured same-origin dev proxy', () => {
    expect(resolveApiUrl({ deploymentMode: 'remoteManual', apiUrl: `${window.location.origin}/api` }))
      .toBe(`${window.location.origin}/api`)
    const ws = `ws://${window.location.host}/ws`
    expect(resolveWsUrl({ deploymentMode: 'remoteManual', wsUrl: ws })).toBe(ws)
  })
})
