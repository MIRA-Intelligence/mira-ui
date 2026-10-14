import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRemoteInstallStore } from './remoteInstallStore'
import { IDLE_REMOTE_SSH_STATUS, type RemoteSshStatus } from '@/services/remoteSsh'

const PLAN = { spec: 'mira-engine>=0.4.0rc1', venv: '${MIRA_HOME:-$HOME/.mira}/venv', script: 'set -e\nmain </dev/null\n', defaultSpec: true }
const CONTEXT = { active: true, host: 'lab', discovery: true }

const status = (patch: Partial<RemoteSshStatus> = {}): RemoteSshStatus => ({ ...IDLE_REMOTE_SSH_STATUS, host: 'lab', ...patch })
const failed = (code: string, patch: Partial<RemoteSshStatus> = {}) => status({ phase: 'error', error: { code: code as never, message: 'detail' }, ...patch })

describe('remote install flow', () => {
  let emitOutput: (chunk: unknown) => void
  let finish: (value: unknown) => void
  let install: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  let cancel: ReturnType<typeof vi.fn<() => Promise<boolean>>>

  beforeEach(() => {
    useRemoteInstallStore.getState().reset()
    emitOutput = () => {}
    install = vi.fn<() => Promise<unknown>>(() => new Promise((resolve) => { finish = resolve }))
    cancel = vi.fn<() => Promise<boolean>>(async () => true)
    window.electronAPI = {
      platform: 'darwin',
      getRemoteInstallPlan: vi.fn(async () => PLAN),
      installRemoteMira: install,
      cancelRemoteInstall: cancel,
      onRemoteInstallOutput: vi.fn((listener) => { emitOutput = listener; return () => { emitOutput = () => {} } }),
    }
  })
  afterEach(() => { delete window.electronAPI })

  const store = () => useRemoteInstallStore.getState()

  it('offers an install for not installed and too old, with the plan, but runs nothing', async () => {
    store().observe(failed('not_installed'), CONTEXT)
    expect(store()).toMatchObject({ step: 'offer', host: 'lab', reason: 'not_installed' })
    await vi.waitFor(() => expect(store().plan).toEqual(PLAN))
    expect(install).not.toHaveBeenCalled()

    store().reset()
    store().observe(failed('too_old', { miraPath: '/usr/bin/mira' }), CONTEXT)
    expect(store()).toMatchObject({ step: 'offer', reason: 'too_old', miraPath: '/usr/bin/mira', detail: 'detail' })
    expect(install).not.toHaveBeenCalled()
  })

  it('does not offer for other errors, other hosts, or a manual command', () => {
    store().observe(failed('auth_required'), CONTEXT)
    store().observe(failed('incompatible'), CONTEXT)
    store().observe(failed('not_installed'), { ...CONTEXT, discovery: false })
    store().observe(failed('not_installed', { host: 'other' }), CONTEXT)
    store().observe(failed('not_installed'), { ...CONTEXT, active: false })
    expect(store().step).toBe('closed')
  })

  it('stays dismissed for the same failure and offers again after a new attempt', () => {
    store().observe(failed('not_installed'), CONTEXT)
    store().dismiss()
    store().observe(failed('not_installed'), CONTEXT)
    expect(store().step).toBe('closed')
    store().observe(status({ phase: 'connecting' }), CONTEXT)
    store().observe(failed('not_installed'), CONTEXT)
    expect(store().step).toBe('offer')
  })

  it('installs only from the offer, streams output, then reconnects and closes', async () => {
    await store().install()
    expect(install).not.toHaveBeenCalled()

    store().observe(failed('not_installed'), CONTEXT)
    const running = store().install()
    expect(store().step).toBe('installing')
    expect(install).toHaveBeenCalledTimes(1)
    emitOutput('Resolved 42 packages\n')
    emitOutput('Installed mira-engine 0.5.0\n')
    expect(store().log).toBe('Resolved 42 packages\nInstalled mira-engine 0.5.0\n')
    // Status updates while installing do not change the step.
    store().observe(failed('not_installed'), CONTEXT)
    expect(store().step).toBe('installing')

    finish({ ok: true, version: '0.5.0', launcher: '/h/.mira/bin/mira' })
    await running
    expect(store()).toMatchObject({ step: 'reconnecting', version: '0.5.0' })
    store().observe(status({ phase: 'connecting' }), CONTEXT)
    expect(store().step).toBe('reconnecting')
    store().observe(status({ phase: 'connected', localPort: 51000 }), CONTEXT)
    expect(store().step).toBe('closed')
  })

  it('cancels the running install and shows failures with a retry', async () => {
    store().observe(failed('not_installed'), CONTEXT)
    const running = store().install()
    store().cancel()
    expect(cancel).toHaveBeenCalled()
    finish({ ok: false, code: 'cancelled', message: 'Installation cancelled.', version: null })
    await running
    expect(store()).toMatchObject({ step: 'failed', error: { code: 'cancelled' } })

    const retry = store().install()
    expect(store().step).toBe('installing')
    expect(store().log).toBe('')
    finish({ ok: false, code: 'no_python', message: 'none', version: null })
    await retry
    expect(store()).toMatchObject({ step: 'failed', error: { code: 'no_python' } })
  })

  it('reports a failed reconnect after a successful install', async () => {
    store().observe(failed('not_installed'), CONTEXT)
    const running = store().install()
    finish({ ok: true, version: '0.5.0', launcher: null })
    await running
    store().observe(failed('start_failed', { error: { code: 'start_failed', message: 'port in use' } }), CONTEXT)
    expect(store()).toMatchObject({ step: 'failed', error: { code: 'reconnect_failed', message: 'port in use' } })
    store().dismiss()
    store().observe(failed('start_failed'), CONTEXT)
    expect(store().step).toBe('closed')
  })
})
