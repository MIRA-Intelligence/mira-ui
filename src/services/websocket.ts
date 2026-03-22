import type { WsMessage, WsResponse } from '@/types'

type MessageHandler = (msg: WsResponse) => void
type StatusHandler = (connected: boolean) => void

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:18790/ws'

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private shouldReconnect = true

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.shouldReconnect = true
    this._connect()
  }

  disconnect(): void {
    this.shouldReconnect = false
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
    return () => this.statusHandlers.delete(handler)
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(WS_URL)
    } catch {
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
      this.statusHandlers.forEach((h) => h(true))
    }

    this.ws.onmessage = (event) => {
      try {
        const data: WsResponse = JSON.parse(event.data)
        this.messageHandlers.forEach((h) => h(data))
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = () => {
      this.statusHandlers.forEach((h) => h(false))
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

export const wsClient = new WebSocketClient()
