import type { WsMessage, WsResponse } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

type MessageHandler = (msg: WsResponse) => void
type StatusHandler = (connected: boolean, detail: string | null) => void

function getWsUrl(): string {
  return useSettingsStore.getState().wsUrl
}

function currentLanguage() {
  return useSettingsStore.getState().language
}

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private shouldReconnect = true
  private lastDisconnectDetail: string | null = null

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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
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
      this.ws = new WebSocket(getWsUrl())
    } catch {
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
      this.lastDisconnectDetail = null
      this.statusHandlers.forEach((h) => h(true, null))
    }

    this.ws.onmessage = (event) => {
      try {
        const data: WsResponse = JSON.parse(event.data)
        this.messageHandlers.forEach((h) => h(data))
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = (event) => {
      this.lastDisconnectDetail = describeCloseEvent(event, getWsUrl())
      this.statusHandlers.forEach((h) => h(false, this.lastDisconnectDetail))
      this._scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private _scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    this.reconnectTimer = setTimeout(() => {
      this._connect()
    }, this.reconnectDelay)
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
