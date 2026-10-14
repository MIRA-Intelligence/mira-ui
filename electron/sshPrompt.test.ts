import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SshPromptBroker } from './sshPrompt'

const REQUEST = { host: 'ana@lab', kind: 'secret' as const, text: "ana@lab's password: ", retry: false }

describe('SshPromptBroker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = (delivered = true) => {
    const send = vi.fn((_channel: string, _payload: unknown) => delivered)
    return { send, broker: new SshPromptBroker({ send, timeoutMs: 1000 }) }
  }
  const sentId = (send: ReturnType<typeof setup>['send']) => (send.mock.calls[0][1] as { id: string }).id

  it('forwards the prompt and resolves with the answer', async () => {
    const { send, broker } = setup()
    const answer = broker.request(REQUEST)
    expect(send).toHaveBeenCalledWith('remote-ssh:prompt', { id: expect.any(String), ...REQUEST })
    expect(broker.respond(sentId(send), 'hunter2')).toBe(true)
    await expect(answer).resolves.toBe('hunter2')
    // Answered prompts cannot be answered again.
    expect(broker.respond(sentId(send), 'again')).toBe(false)
  })

  it('treats null as cancel and validates responses', async () => {
    const { send, broker } = setup()
    const answer = broker.request(REQUEST)
    const id = sentId(send)
    expect(broker.respond('unknown', 'x')).toBe(false)
    expect(broker.respond(id, 42)).toBe(false)
    expect(broker.respond(id, 'x'.repeat(5000))).toBe(false)
    expect(broker.respond(id, null)).toBe(true)
    await expect(answer).resolves.toBeNull()
  })

  it('cancels after the timeout and tells the renderer to close the dialog', async () => {
    const { send, broker } = setup()
    const answer = broker.request(REQUEST)
    vi.advanceTimersByTime(1000)
    await expect(answer).resolves.toBeNull()
    expect(send).toHaveBeenLastCalledWith('remote-ssh:prompt-cancel', { id: sentId(send) })
  })

  it('cancels when the connection attempt is aborted', async () => {
    const { send, broker } = setup()
    const controller = new AbortController()
    const answer = broker.request(REQUEST, controller.signal)
    controller.abort()
    await expect(answer).resolves.toBeNull()
    expect(send).toHaveBeenLastCalledWith('remote-ssh:prompt-cancel', { id: sentId(send) })
    await expect(broker.request(REQUEST, controller.signal)).resolves.toBeNull()
  })

  it('cancels immediately when no window can show the prompt, and on cancelAll', async () => {
    const { broker } = setup(false)
    await expect(broker.request(REQUEST)).resolves.toBeNull()
    const shown = setup()
    const first = shown.broker.request(REQUEST)
    const second = shown.broker.request({ ...REQUEST, retry: true })
    shown.broker.cancelAll()
    await expect(Promise.all([first, second])).resolves.toEqual([null, null])
  })
})
