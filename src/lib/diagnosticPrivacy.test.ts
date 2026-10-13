import { describe, expect, it } from 'vitest'
import { diagnosticRoute, safeDiagnosticError, sanitizeDiagnosticEvent } from './diagnosticPrivacy'

describe('diagnostic metadata boundaries', () => {
  it('drops content, credentials, paths, arbitrary messages and exception source prose', () => {
    const error = new Error('patient-private token=private-value')
    error.stack = 'Error: patient-private token=private-value\n    at run (/Users/private/src/app.ts:42:3)'
    const record = sanitizeDiagnosticEvent({ event: 'renderer.failed', level: 'ERROR',
      fields: { content: 'patient-private', token: 'private-value', route: '/api/projects/:id',
        reason: 'patient private name', request_id: 'req-123' }, error: safeDiagnosticError(error) })
    expect(record?.error).toEqual({ type: 'Error', frames: ['app.ts:42:3'] })
    expect(record?.fields).toEqual({ route: '/api/projects/:id', request_id: 'req-123' })
    expect(JSON.stringify(record)).not.toContain('patient-private')
    expect(JSON.stringify(record)).not.toContain('/Users/private')
  })

  it('normalizes dynamic routes and strips query, userinfo and host', () => {
    expect(diagnosticRoute('https://user:secret@example.org/api/sessions/patient-Jane/history?token=secret'))
      .toBe('/api/sessions/:id/history')
  })

  it('rejects forged stack strings and malformed event names at the IPC boundary', () => {
    const record = sanitizeDiagnosticEvent({ event: 'renderer.error', error: {
      type: 'TypeError', frames: ['app.js:1:2', 'patient-private secret=foo', '/Users/private/app.js:1:2'],
    } })
    expect(record?.error?.frames).toEqual(['app.js:1:2'])
    expect(sanitizeDiagnosticEvent({ event: 'contains private message' })).toBeNull()
  })
})
