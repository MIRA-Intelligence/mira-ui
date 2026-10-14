import { randomUUID } from 'node:crypto'
import { ANSWER_LIMIT, type SshPromptRequest } from './sshAskpass'

// Relays ssh prompts to the renderer (SshPromptDialog) and waits for the
// user's answer. The renderer sees the prompt text, never other secrets; the
// answer is handed straight back to the askpass helper and not kept here.

export const PROMPT_TIMEOUT_MS = 120_000

export interface SshPromptEvent extends SshPromptRequest {
  id: string
}

// notify: also tell the renderer to close the dialog (timeout, abort).
type Finish = (answer: string | null, notify: boolean) => void

export interface SshPromptBrokerOptions {
  // Returns false when no window can show the prompt.
  send: (channel: 'remote-ssh:prompt' | 'remote-ssh:prompt-cancel', payload: unknown) => boolean
  timeoutMs?: number
}

export class SshPromptBroker {
  private readonly pending = new Map<string, Finish>()

  constructor(private readonly options: SshPromptBrokerOptions) {}

  request(request: SshPromptRequest, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return Promise.resolve(null)
    const id = randomUUID()
    return new Promise((resolve) => {
      const onAbort = () => finish(null, true)
      const timer = setTimeout(() => finish(null, true), this.options.timeoutMs ?? PROMPT_TIMEOUT_MS)
      const finish: Finish = (answer, notify) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (notify) this.options.send('remote-ssh:prompt-cancel', { id })
        resolve(answer)
      }
      this.pending.set(id, finish)
      signal?.addEventListener('abort', onAbort, { once: true })
      const event: SshPromptEvent = { id, ...request }
      if (!this.options.send('remote-ssh:prompt', event)) finish(null, false)
    })
  }

  // From the renderer: a string answers the prompt, null cancels it.
  respond(id: unknown, answer: unknown): boolean {
    if (typeof id !== 'string' || !this.pending.has(id)) return false
    if (answer !== null && (typeof answer !== 'string' || answer.length > ANSWER_LIMIT)) return false
    this.pending.get(id)!(answer, false)
    return true
  }

  cancelAll(): void {
    for (const finish of [...this.pending.values()]) finish(null, true)
  }
}
