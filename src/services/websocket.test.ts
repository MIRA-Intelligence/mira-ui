import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/stores/settingsStore'
import { wsClient } from './websocket'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  send(): void {}

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
}

describe('wsClient', () => {
  beforeEach(() => {
    wsClient.disconnect()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    useSettingsStore.setState({
      deploymentMode: 'localBundle',
      apiUrl: 'http://127.0.0.1:18790/api',
      wsUrl: 'ws://127.0.0.1:18790/ws',
      engineTokens: {},
    })
  })

  it('replays current connected status to late subscribers', () => {
    wsClient.connect()

    const socket = MockWebSocket.instances.at(-1)
    expect(socket?.url).toBe('ws://127.0.0.1:18790/ws?turn_events=1')
    socket?.emitOpen()

    const statuses: boolean[] = []
    const unsubscribe = wsClient.onStatus((connected) => {
      statuses.push(connected)
    })

    expect(statuses).toEqual([true])

    unsubscribe()
  })

  it('does not create duplicate sockets while already connecting or connected', () => {
    wsClient.connect()
    wsClient.connect()

    expect(MockWebSocket.instances).toHaveLength(1)

    const socket = MockWebSocket.instances[0]
    socket?.emitOpen()
    wsClient.connect()

    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('connects with the gateway token without exposing it in the close detail', () => {
    useSettingsStore.setState({
      deploymentMode: 'remoteManual',
      apiUrl: 'https://mira.lab.example:18790/api',
      wsUrl: 'wss://mira.lab.example:18790/ws',
      engineTokens: { 'https://mira.lab.example:18790': 'remote-token-0123456789' },
    })
    const details: Array<string | null> = []
    wsClient.onStatus((_connected, detail) => details.push(detail))
    wsClient.connect()

    const socket = MockWebSocket.instances.at(-1)
    expect(new URL(socket!.url).searchParams.get('access_token')).toBe('remote-token-0123456789')
    expect(new URL(socket!.url).searchParams.get('turn_events')).toBe('1')
    wsClient.disconnect()
    expect(details.join(' ')).not.toContain('remote-token')
  })
})
