import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  IDLE_REMOTE_SSH_STATUS,
  connectRemoteSsh,
  listSshHosts,
  onRemoteSshStatus,
  sanitizeRemoteSshStatus,
  tunnelEndpoints,
} from './remoteSsh'
import { remoteSshMessage } from '@/lib/remoteSshMessages'

describe('remoteSsh renderer bridge', () => {
  afterEach(() => { delete window.electronAPI })

  it('maps a tunnel port to loopback API and WebSocket endpoints', () => {
    expect(tunnelEndpoints(51000)).toEqual({ apiUrl: 'http://127.0.0.1:51000/api', wsUrl: 'ws://127.0.0.1:51000/ws' })
  })

  it('sanitizes status payloads crossing the IPC boundary', () => {
    expect(sanitizeRemoteSshStatus(null)).toEqual(IDLE_REMOTE_SSH_STATUS)
    expect(sanitizeRemoteSshStatus({ phase: 'hacked' })).toEqual(IDLE_REMOTE_SSH_STATUS)
    expect(sanitizeRemoteSshStatus({ phase: 'connected', host: 'lab', localPort: 99999, version: '1', token: 'x', attempt: 0 }))
      .toEqual({ phase: 'connected', host: 'lab', localPort: null, version: '1', error: null, attempt: 0 })
  })

  it('reports Remote-SSH as unavailable outside the desktop app', async () => {
    expect((await connectRemoteSsh('lab')).error?.code).toBe('unavailable')
    expect(await listSshHosts()).toEqual([])
    expect(onRemoteSshStatus(() => {})).toBeTypeOf('function')
  })

  it('passes hosts and status events through the bridge', async () => {
    let emit: (status: unknown) => void = () => {}
    window.electronAPI = {
      platform: 'linux',
      remoteSshConnect: vi.fn(async () => ({ phase: 'connecting' as const, host: 'lab', localPort: null, version: null, error: null, attempt: 0 })),
      listSshHosts: vi.fn(async () => ['lab', 42 as unknown as string]),
      onRemoteSshStatus: vi.fn((listener) => { emit = listener; return () => {} }),
    }
    expect((await connectRemoteSsh('lab')).phase).toBe('connecting')
    expect(await listSshHosts()).toEqual(['lab'])
    const seen = vi.fn()
    onRemoteSshStatus(seen)
    emit({ phase: 'error', host: 'lab', localPort: null, version: null, error: { code: 'host_key', message: 'Host key verification failed.' }, attempt: 0 })
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ phase: 'error', error: { code: 'host_key', message: 'Host key verification failed.' } }))
  })
})

describe('remoteSshMessage', () => {
  const base = { ...IDLE_REMOTE_SSH_STATUS, host: 'lab' }

  it('describes each phase', () => {
    expect(remoteSshMessage({ ...base, phase: 'connecting' }, 'en')).toBe('Connecting to lab over SSH…')
    expect(remoteSshMessage({ ...base, phase: 'connected', version: '0.5.0', localPort: 51000 }, 'en')).toBe('Connected to lab · mira-engine 0.5.0')
    expect(remoteSshMessage({ ...base, phase: 'reconnecting', attempt: 3 }, 'zh')).toContain('第 3 次')
  })

  it('gives actionable errors and falls back to the engine message', () => {
    const error = (code: string, message = 'detail') => ({ ...base, phase: 'error' as const, error: { code: code as never, message } })
    expect(remoteSshMessage(error('auth_required'), 'en')).toContain('`ssh lab` works in a terminal')
    expect(remoteSshMessage(error('host_key'), 'en')).toContain('Run `ssh lab` once')
    expect(remoteSshMessage(error('not_installed'), 'en')).toContain('Could not run `mira` on lab')
    expect(remoteSshMessage(error('not_installed'), 'en', '', '/opt/mira/bin/mira')).toContain('`/opt/mira/bin/mira`')
    expect(remoteSshMessage(error('not_installed'), 'en')).toContain('docs/remote-ssh.md')
    expect(remoteSshMessage(error('invalid_command'), 'en')).toContain('plain path')
    expect(remoteSshMessage(error('lease_conflict', 'another engine owns ~/.mira'), 'en'))
      .toBe('The engine on lab could not start (lease_conflict): another engine owns ~/.mira')
  })
})
