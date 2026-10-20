import type { WsMessage, WsResponse } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import { recordDiagnostic } from './diagnostics'
import { createUuid } from '@/lib/uuid'
import { refreshManagedEngineTokens, withEngineAuth } from './engineAuth'

type MessageHandler = (msg: WsResponse) => void
type StatusHandler = (connected: boolean, detail: string | null) => void

function getWsUrl(): string {
  return useSettingsStore.getState().wsUrl
}

/** Ask the engine for turn_started/turn_finished; it withholds them from older clients. */
function withTurnEvents(wsUrl: string): string {
  try {
    const url = new URL(wsUrl)
    url.searchParams.set('turn_events', '1')
    return url.toString()
  } catch {
    return wsUrl
  }
}

function currentLanguage() {
  return useSettingsStore.getState().language
}

const MAX_RECONNECT_DELAY = 10_000
const INITIAL_RECONNECT_DELAY = 500
// Messages the user sends while the socket is (re)connecting are held and
// flushed on open instead of being dropped on the floor.
const MAX_QUEUED_MESSAGES = 32

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private shouldReconnect = true
  private lastDisconnectDetail: string | null = null
  private outbox: string[] = []

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.shouldReconnect = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }
    this._connect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.lastDisconnectDetail = null
    this.outbox = []
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(msg: WsMessage): void {
    const requestId = msg.request_id || createUuid()
    const frame = JSON.stringify({ ...msg, request_id: requestId })
    if (this.ws?.readyState === WebSocket.OPEN) {
      recordDiagnostic('websocket.sent', { operation: msg.type, request_id: requestId })
      this.ws.send(frame)
      return
    }
    if (!this.shouldReconnect) return
    recordDiagnostic('websocket.queued', { operation: msg.type, request_id: requestId })
    this.outbox.push(frame)
    if (this.outbox.length > MAX_QUEUED_MESSAGES) this.outbox.shift()
  }

  private flushOutbox(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const queued = this.outbox
    this.outbox = []
    for (const frame of queued) this.ws.send(frame)
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.connected, this.connected ? null : this.lastDisconnectDetail)
    return () => this.statusHandlers.delete(handler)
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(withEngineAuth(withTurnEvents(getWsUrl())))
    } catch {
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      recordDiagnostic('websocket.connected')
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
      this.lastDisconnectDetail = null
      this.statusHandlers.forEach((h) => h(true, null))
      this.flushOutbox()
    }

    this.ws.onmessage = (event) => {
      try {
        const data: WsResponse = JSON.parse(event.data)
        this.messageHandlers.forEach((h) => h(data))
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = (event) => {
      recordDiagnostic('websocket.closed', { code: event?.code ?? 0 }, undefined, 'WARNING')
      this.lastDisconnectDetail = describeCloseEvent(event, getWsUrl())
      this.statusHandlers.forEach((h) => h(false, this.lastDisconnectDetail))
      this._scheduleReconnect()
    }

    this.ws.onerror = () => {
      recordDiagnostic('websocket.failed', {}, undefined, 'ERROR')
      this.ws?.close()
    }
  }

  private _scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    // A rejected handshake looks like any other close; pick up a rotated
    // desktop or re-attached Remote-SSH token before trying again.
    void refreshManagedEngineTokens()
    // Jitter keeps many windows/tabs from hammering the engine in lockstep.
    const jitter = Math.random() * 0.3 * this.reconnectDelay
    this.reconnectTimer = setTimeout(() => {
      this._connect()
    }, this.reconnectDelay + jitter)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY)
  }
}

function describeCloseEvent(event: CloseEvent | undefined, url: string): string {
  const lang = currentLanguage()
  const code = typeof event?.code === 'number' ? event.code : 0
  const reason = typeof event?.reason === 'string' ? event.reason.trim() : ''
  if (reason) {
    return t('wsClosedReason', lang, { code: code || 'unknown', reason })
  }
  if (code === 1006 || code === 0) {
    return t('wsUnableConnectDetail', lang, { url })
  }
  return t('wsClosedCodeDetail', lang, { url, code })
}

export const wsClient = new WebSocketClient()
