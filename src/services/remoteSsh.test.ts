import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  IDLE_REMOTE_SSH_STATUS,
  answerSshPrompt,
  connectRemoteSsh,
  listSshHosts,
  onRemoteSshStatus,
  onSshPrompt,
  onSshPromptCancel,
  sanitizeRemoteSshStatus,
  sanitizeSshPrompt,
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
      .toEqual({ phase: 'connected', host: 'lab', localPort: null, version: '1', error: null, attempt: 0, miraPath: null })
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
      remoteSshConnect: vi.fn(async () => ({ phase: 'connecting' as const, host: 'lab', localPort: null, version: null, error: null, attempt: 0, miraPath: null })),
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
    // Discovery searched for mira; a manual command is named in the message.
    expect(remoteSshMessage(error('not_installed'), 'en')).toContain('Mira was not found on lab')
    expect(remoteSshMessage(error('not_installed'), 'zh')).toContain('没有找到 Mira')
    expect(remoteSshMessage(error('not_installed'), 'en', '', '/opt/mira/bin/mira')).toContain('Could not run `/opt/mira/bin/mira` on lab')
    expect(remoteSshMessage(error('not_installed'), 'en', '', '/opt/mira/bin/mira')).toContain('docs/remote-ssh.md')
    expect(remoteSshMessage(error('too_old'), 'en')).toContain('too old for Remote-SSH')
    expect(remoteSshMessage(error('incompatible'), 'en')).toContain('Update the MIRA desktop app')
    expect(remoteSshMessage(error('invalid_command'), 'en')).toContain('plain path')
    expect(remoteSshMessage(error('lease_conflict', 'another engine owns ~/.mira'), 'en'))
      .toBe('The engine on lab could not start (lease_conflict): another engine owns ~/.mira')
  })
})

describe('Remote-SSH login prompts bridge', () => {
  afterEach(() => { delete window.electronAPI })

  it('sanitizes prompts crossing the IPC boundary', () => {
    expect(sanitizeSshPrompt(null)).toBeNull()
    expect(sanitizeSshPrompt({ id: '', text: 'x' })).toBeNull()
    expect(sanitizeSshPrompt({ id: 'p1', host: 'lab', kind: 'weird', text: 'Password: ', retry: 'yes', extra: 1 }))
      .toEqual({ id: 'p1', host: 'lab', kind: 'secret', text: 'Password: ', retry: false })
    expect(sanitizeSshPrompt({ id: 'p2', kind: 'host_key', text: 'x'.repeat(5000), retry: true }))
      .toMatchObject({ kind: 'host_key', retry: true, host: '' })
    expect(sanitizeSshPrompt({ id: 'p2', text: 'x'.repeat(5000) })!.text).toHaveLength(4000)
  })

  it('subscribes to prompts and cancellations and sends answers', async () => {
    let emitPrompt: (value: unknown) => void = () => {}
    let emitCancel: (value: unknown) => void = () => {}
    const answer = vi.fn(async () => true)
    window.electronAPI = {
      platform: 'darwin',
      onRemoteSshPrompt: vi.fn((listener) => { emitPrompt = listener; return () => {} }),
      onRemoteSshPromptCancel: vi.fn((listener) => { emitCancel = listener; return () => {} }),
      answerRemoteSshPrompt: answer,
    }
    const prompts: unknown[] = []
    const cancels: string[] = []
    onSshPrompt((prompt) => prompts.push(prompt))
    onSshPromptCancel((id) => cancels.push(id))
    emitPrompt({ id: 'p1', host: 'lab', kind: 'secret', text: 'Password: ', retry: false })
    emitPrompt({ nonsense: true })
    emitCancel({ id: 'p1' })
    emitCancel('p1')
    expect(prompts).toEqual([{ id: 'p1', host: 'lab', kind: 'secret', text: 'Password: ', retry: false }])
    expect(cancels).toEqual(['p1'])
    expect(await answerSshPrompt('p1', 'hunter2')).toBe(true)
    expect(answer).toHaveBeenCalledWith('p1', 'hunter2')
  })

  it('cannot answer outside the desktop app', async () => {
    expect(await answerSshPrompt('p1', null)).toBe(false)
    expect(onSshPrompt(() => {})).toBeTypeOf('function')
  })

  it('explains cancelled logins, changed host keys and old Windows OpenSSH', () => {
    const error = (code: string, message = '') => ({ ...IDLE_REMOTE_SSH_STATUS, phase: 'error' as const, host: 'lab', error: { code: code as never, message } })
    expect(remoteSshMessage(error('auth_cancelled'), 'en')).toBe('Login to lab was cancelled.')
    expect(remoteSshMessage(error('host_key_changed'), 'en')).toContain('has changed')
    expect(remoteSshMessage(error('prompt_unsupported', 'OpenSSH_for_Windows_8.1'), 'zh')).toContain('OpenSSH_for_Windows_8.1')
    expect(remoteSshMessage(error('auth_required', 'Permission denied (password).'), 'en')).toContain('Permission denied (password).')
  })
})
