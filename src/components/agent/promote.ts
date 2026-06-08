import type { LogEntry as AgentLogEntry } from '@/types'

/** Build project-description seed from a chat transcript for promote-to-project. */
export function buildPromotePrefill(logs: AgentLogEntry[]): string {
  const lines: string[] = []
  for (const entry of logs) {
    if (entry.type !== 'response') continue
    const who = entry.metadata?._user ? 'User' : 'Mira'
    const text = entry.content.trim()
    if (!text) continue
    lines.push(`${who}: ${text}`)
  }
  return lines.join('\n\n').slice(0, 4000)
}
