import type { FeedbackPayload } from './types'

const STORAGE_KEY = 'medpilot-feedback-queue'
const MAX_QUEUE_LENGTH = 10

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

interface QueueEntry {
  payload: FeedbackPayload
  attempts: number
  lastError: string | null
}

function loadQueue(): QueueEntry[] {
  const ls = safeLocalStorage()
  if (!ls) return []
  try {
    const raw = ls.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is QueueEntry => Boolean(e && typeof e === 'object' && 'payload' in e),
    )
  } catch {
    return []
  }
}

function persistQueue(entries: QueueEntry[]): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    const trimmed = entries.slice(-MAX_QUEUE_LENGTH)
    ls.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

export function enqueue(payload: FeedbackPayload, error: string): void {
  const entries = loadQueue()
  entries.push({ payload, attempts: 1, lastError: error })
  persistQueue(entries)
}

export function getQueue(): QueueEntry[] {
  return loadQueue()
}

export function clearQueue(): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try { ls.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function queueLength(): number {
  return loadQueue().length
}

export interface FlushResult {
  attempted: number
  delivered: number
  remaining: number
}

export async function flushQueue(
  send: (payload: FeedbackPayload) => Promise<void>,
): Promise<FlushResult> {
  const entries = loadQueue()
  if (entries.length === 0) {
    return { attempted: 0, delivered: 0, remaining: 0 }
  }

  let delivered = 0
  const remaining: QueueEntry[] = []
  for (const entry of entries) {
    try {
      await send(entry.payload)
      delivered += 1
    } catch (err) {
      remaining.push({
        payload: entry.payload,
        attempts: entry.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      })
    }
  }
  persistQueue(remaining)
  return { attempted: entries.length, delivered, remaining: remaining.length }
}
