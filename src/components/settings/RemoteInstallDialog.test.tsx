import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RemoteInstallDialog } from './RemoteInstallDialog'
import { IDLE_REMOTE_SSH_STATUS, type RemoteSshStatus } from '@/services/remoteSsh'
import { useRemoteInstallStore } from '@/stores/remoteInstallStore'
import { useRemoteSshStore } from '@/stores/remoteSshStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialSettings = useSettingsStore.getState()
const SCRIPT = '# Install Mira\nset -e\nuv venv --python \'>=3.11\' "$venv"\nmain </dev/null\n'
const PLAN = { spec: 'mira-engine>=0.4.0rc1', venv: '${MIRA_HOME:-$HOME/.mira}/venv', script: SCRIPT, defaultSpec: true }

const setStatus = (patch: Partial<RemoteSshStatus>) => act(() => {
  useRemoteSshStore.getState().setStatus({ ...IDLE_REMOTE_SSH_STATUS, host: 'lab', ...patch })
})
const notInstalled = () => setStatus({ phase: 'error', error: { code: 'not_installed', message: 'mira was not found on the server.' } })

describe('RemoteInstallDialog', () => {
  let emitOutput: (chunk: unknown) => void
  let finish: (value: unknown) => void
  let install: ReturnType<typeof vi.fn<() => Promise<unknown>>>

  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettings, language: 'en', deploymentMode: 'remoteSsh', sshHost: 'lab', sshMiraCommand: '', settingsOpen: false }, true)
    useRemoteSshStore.setState({ status: IDLE_REMOTE_SSH_STATUS, miraCommandFocus: 0 })
    useRemoteInstallStore.getState().reset()
    emitOutput = () => {}
    install = vi.fn<() => Promise<unknown>>(() => new Promise((resolve) => { finish = resolve }))
    window.electronAPI = {
      platform: 'darwin',
      getRemoteInstallPlan: vi.fn(async () => PLAN),
      installRemoteMira: install,
      cancelRemoteInstall: vi.fn(async () => true),
      onRemoteInstallOutput: vi.fn((listener) => { emitOutput = listener; return () => {} }),
    }
  })
  afterEach(() => { delete window.electronAPI })

  it('stays hidden until Mira is missing on the server', () => {
    render(<RemoteInstallDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
    setStatus({ phase: 'error', error: { code: 'auth_required', message: 'denied' } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('explains why, where and exactly what will run before anything runs', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    const dialog = await screen.findByRole('dialog')
    // Portalled to <body> above Settings.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.className).toContain('z-[1900]')
    expect(screen.getByText('Install Mira on lab?')).toBeTruthy()
    expect(screen.getByText(/Mira was not found on lab/)).toBeTruthy()
    expect(screen.getByText(/\$\{MIRA_HOME:-\$HOME\/\.mira\}\/venv/)).toBeTruthy()
    expect(screen.getByText(/does not use sudo/)).toBeTruthy()
    expect(await screen.findByText('Package: mira-engine>=0.4.0rc1')).toBeTruthy()
    expect(screen.getByLabelText(/Script that will run on lab/).textContent).toBe(SCRIPT)
    expect(install).not.toHaveBeenCalled()
  })

  it('names the old engine it found', async () => {
    render(<RemoteInstallDialog />)
    setStatus({ phase: 'error', miraPath: '/opt/conda/bin/mira', error: { code: 'too_old', message: "Error: No such command 'remote'." } })
    expect(await screen.findByText(/too old for Remote-SSH: Error: No such command 'remote'\./)).toBeTruthy()
    expect(screen.getByText('Found: /opt/conda/bin/mira')).toBeTruthy()
  })

  it('installs on consent, streams output, and closes once reconnected', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(install).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Installing Mira on lab')
    act(() => emitOutput('Resolved 42 packages\n'))
    expect(screen.getByLabelText('Output').textContent).toContain('Resolved 42 packages')
    // Escape does not abandon a running install.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => finish({ ok: true, version: '0.5.0', launcher: '/h/.mira/bin/mira' }))
    expect(screen.getByRole('status').textContent).toContain('Installed mira-engine 0.5.0. Reconnecting')
    setStatus({ phase: 'connected', localPort: 51000, version: '0.5.0' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops a running install and shows the failure with a retry', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.electronAPI!.cancelRemoteInstall).toHaveBeenCalled()
    await act(async () => finish({ ok: false, code: 'cancelled', message: 'Installation cancelled.', version: null }))
    expect(screen.getByRole('alert').textContent).toContain('Installation stopped')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => finish({ ok: false, code: 'no_python', message: '', version: null }))
    expect(screen.getByRole('alert').textContent).toContain('curl -LsSf https://astral.sh/uv/install.sh | sh')
    expect(install).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('explains an installed engine without remote setup', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    await act(async () => finish({ ok: false, code: 'too_old', message: "No such command 'setup'.", version: '0.3.5rc1' }))
    expect(screen.getByRole('alert').textContent).toContain('mira-engine 0.3.5rc1 was installed')
    expect(screen.getByRole('alert').textContent).toContain('MIRA_REMOTE_INSTALL_SPEC')
  })

  it('cancels without running anything and is not shown again for the same failure', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    notInstalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('jumps to the per-host path field on "Specify path manually"', async () => {
    render(<RemoteInstallDialog />)
    notInstalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Specify path manually' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useRemoteSshStore.getState().miraCommandFocus).toBe(1)
    expect(install).not.toHaveBeenCalled()
  })

  it('is not offered when a remote mira command is set by hand', async () => {
    useSettingsStore.setState({ sshMiraCommand: '/opt/mira/bin/mira' })
    render(<RemoteInstallDialog />)
    notInstalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('speaks Chinese', async () => {
    useSettingsStore.setState({ language: 'zh' })
    render(<RemoteInstallDialog />)
    notInstalled()
    expect(await screen.findByText('在 lab 上安装 Mira？')).toBeTruthy()
    expect(screen.getByRole('button', { name: '安装' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '手动指定路径' })).toBeTruthy()
  })
})
