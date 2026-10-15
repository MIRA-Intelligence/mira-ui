// Diagnostics are metadata, never an alternate copy of conversations or config.
export type DiagnosticLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
export interface DiagnosticEvent {
  timestamp: string
  level: DiagnosticLevel
  event: string
  fields: Record<string, string | number | boolean | null>
  error?: { type: string; frames: string[] }
}

const fields = new Set([
  'request_id', 'run_id', 'connection_id', 'previous_boot_id', 'method', 'route',
  'status', 'duration_ms', 'code', 'exit_code', 'reason', 'operation', 'phase',
  'count', 'window_id', 'process_type', 'signal', 'timed_out', 'version', 'trace_supported',
])
const safeToken = /^[A-Za-z0-9_.:{}<>/-]{1,160}$/
const routeWords = new Set([
  'api', 'v1', 'health', 'version', 'status', 'config', 'providers', 'models', 'test',
  'sessions', 'history', 'skills', 'plan', 'contract', 'lint', 'projects', 'organization',
  'feedback', 'workflows', 'runs', 'modules', 'artifacts', 'tasks', 'settings', 'chat',
  'context-preview', 'workspace', 'files', 'download', 'upload', 'engine',
])

export function diagnosticRoute(value: string): string {
  try {
    const url = new URL(value, 'http://local.invalid')
    return '/' + url.pathname.split('/').filter(Boolean)
      .map((part) => routeWords.has(part) ? part : ':id').join('/')
  } catch { return '<unknown>' }
}

export function safeDiagnosticError(error: unknown): DiagnosticEvent['error'] {
  if (!(error instanceof Error)) return { type: 'NonErrorRejection', frames: [] }
  // The first stack line is the exception message and can contain private data.
  // Keep only source locations; discard URL query/hash/userinfo and absolute paths.
  const frames = (error.stack ?? '').split('\n').slice(1)
    .flatMap((line) => {
      const match = line.match(/(?:^|[(/\\])([A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?|jsx))(?:[?#][^\s:)]*)?:(\d+):(\d+)/)
      return match ? [`${match[1]}:${match[2]}:${match[3]}`] : []
    }).slice(0,30)
  return { type: safeToken.test(error.name) ? error.name : 'Error', frames }
}

export function sanitizeDiagnosticEvent(input: unknown): DiagnosticEvent | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.event !== 'string' || !/^[a-z][a-z0-9_.]{0,79}$/.test(value.event)) return null
  const level = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(String(value.level))
    ? value.level as DiagnosticLevel : 'INFO'
  const picked: DiagnosticEvent['fields'] = {}
  if (value.fields && typeof value.fields === 'object') {
    for (const [key, data] of Object.entries(value.fields).slice(0,30)) {
      if (!fields.has(key)) continue
      if (typeof data === 'string') {
        if (safeToken.test(data)) picked[key] = data
      } else if (data === null || typeof data === 'boolean' || typeof data === 'number' && Number.isFinite(data)) {
        picked[key] = data
      }
    }
  }
  const record: DiagnosticEvent = { timestamp: new Date().toISOString(), event: value.event, level, fields: picked }
  if (value.error && typeof value.error === 'object') {
    const error = value.error as Record<string, unknown>
    record.error = {
      type: typeof error.type === 'string' && safeToken.test(error.type) ? error.type : 'Error',
      frames: Array.isArray(error.frames) ? error.frames
        .filter((frame): frame is string => typeof frame === 'string'
          && /^[A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?|jsx):\d+:\d+$/.test(frame)).slice(0,30) : [],
    }
  }
  return record
}
