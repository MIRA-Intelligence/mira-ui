import { useSettingsStore } from '@/stores/settingsStore'
import { withEngineAuth } from './engineAuth'
import type { WorkflowSocketMessage } from '@/types'

type Handler = (message: WorkflowSocketMessage) => void
type CursorProvider = () => number

function workflowWsUrl(): string {
  const settings = useSettingsStore.getState()
  const configured = settings.deploymentMode === 'localBundle'
    ? 'ws://127.0.0.1:18790/ws'
    : settings.wsUrl
  try {
    const url = new URL(configured)
    url.pathname = '/ws/workflow/v1'
    url.search = ''
    return url.toString()
  } catch {
    return configured.replace(/\/ws\/?$/, '/ws/workflow/v1')
  }
}

class WorkflowWebSocketClient {
  private socket: WebSocket | null = null
  private handlers = new Set<Handler>()
  private projectId: string | null = null
  private cursor: CursorProvider = () => 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private enabled = false

  subscribe(projectId: string, cursor: CursorProvider): void {
    this.projectId = projectId
    this.cursor = cursor
    this.enabled = true
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscription()
      return
    }
    this.connect()
  }

  stop(): void {
    this.enabled = false
    this.projectId = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.close()
    this.socket = null
  }

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private connect(): void {
    if (!this.enabled || !this.projectId) return
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    try {
      this.socket = new WebSocket(withEngineAuth(workflowWsUrl()))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket.onopen = () => {
      this.reconnectDelay = 1_000
      this.sendSubscription()
    }
    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WorkflowSocketMessage
        this.handlers.forEach((handler) => handler(message))
      } catch {
        this.handlers.forEach((handler) => handler({
          message_type: 'protocol_error',
          error: { code: 'malformed_server_message', message: 'Invalid workflow WebSocket message' },
        }))
      }
    }
    this.socket.onclose = () => {
      this.socket = null
      this.scheduleReconnect()
    }
    this.socket.onerror = () => this.socket?.close()
  }

  private sendSubscription(): void {
    if (!this.projectId || this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({
      message_type: 'subscribe',
      workflow_contract_version: 1,
      subscription_id: `ui:${this.projectId}`,
      project_id: this.projectId,
      after_project_sequence: this.cursor(),
      include_transient: true,
    }))
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
  }
}

export const workflowWsClient = new WorkflowWebSocketClient()
