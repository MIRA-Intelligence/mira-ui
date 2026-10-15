import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { EngineLifecycleControls } from './EngineLifecycleControls'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import * as desktop from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'

vi.mock('@/services/desktop', () => ({
  hasDesktopEngineManager: vi.fn(), getLocalEngineStatus: vi.fn(),
  startLocalEngine: vi.fn(), stopLocalEngine: vi.fn(), restartLocalEngine: vi.fn(),
}))
vi.mock('@/services/engine', () => ({ probeEngineCompatibility: vi.fn() }))

const ok = { ok: true, code: 0, stdout: '', stderr: '', command: [], executablePath: '/engine' }
const running = { installed: true, running: true, healthy: true, pid: 123, config_path: '/data/config.json' }
function Controls() {
  const [busy, setBusy] = useState(false)
  return <EngineLifecycleControls busy={busy} onBusyChange={setBusy} />
}
async function open() {
  render(<Controls />)
  await screen.findByText('PID: 123')
}

describe('engine lifecycle controls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSettingsStore.setState({ language: 'en', deploymentMode: 'localBundle' })
    useAgentStore.setState({ connected: true })
    vi.mocked(desktop.hasDesktopEngineManager).mockReturnValue(true)
    vi.mocked(desktop.getLocalEngineStatus).mockResolvedValue({ result: ok, payload: running })
    for (const command of [desktop.startLocalEngine, desktop.stopLocalEngine, desktop.restartLocalEngine]) {
      vi.mocked(command).mockResolvedValue(ok)
    }
    vi.mocked(probeEngineCompatibility).mockResolvedValue({ status: 'compatible', message: 'Ready', version: '1.0', uptimeSeconds: 1 })
  })

  it('queries status on mount without starting any process', async () => {
    await open()
    expect(screen.getByText('Config: /data/config.json')).toBeInTheDocument()
    expect(desktop.startLocalEngine).not.toHaveBeenCalled()
    expect(desktop.restartLocalEngine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(desktop.getLocalEngineStatus).toHaveBeenCalledTimes(2))
  })

  it('requires confirmation and allows cancellation without stopping', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Stop local engine' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('interrupt research or experiments')
    expect(desktop.stopLocalEngine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(desktop.stopLocalEngine).not.toHaveBeenCalled()
  })

  it('stops and updates connection state without restarting', async () => {
    await open()
    vi.mocked(desktop.getLocalEngineStatus).mockResolvedValue({ result: ok, payload: { installed: true, running: false, healthy: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Stop local engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Stop local engine completed.')
    expect(useAgentStore.getState().connected).toBe(false)
    expect(useSettingsStore.getState().engineStatus).toBe('unreachable')
    expect(desktop.startLocalEngine).not.toHaveBeenCalled()
  })

  it('uses the atomic restart command, not a stop/start pair', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Restart local engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Restart local engine completed.')
    expect(desktop.restartLocalEngine).toHaveBeenCalledTimes(1)
    expect(desktop.stopLocalEngine).not.toHaveBeenCalled()
    expect(desktop.startLocalEngine).not.toHaveBeenCalled()
  })

  it('surfaces command stdout errors and never falls back to start', async () => {
    await open()
    vi.mocked(desktop.restartLocalEngine).mockResolvedValue({ ...ok, ok: false, code: 1, stdout: 'stop timed out' })
    fireEvent.click(screen.getByRole('button', { name: 'Restart local engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('stop timed out')
    expect(desktop.startLocalEngine).not.toHaveBeenCalled()
    expect(probeEngineCompatibility).not.toHaveBeenCalled()
  })

  it('disables duplicate operations until the command completes', async () => {
    await open()
    let finish!: (value: typeof ok) => void
    vi.mocked(desktop.startLocalEngine).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Start local engine' }))
    expect(screen.getByRole('button', { name: 'Stop local engine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled()
    finish(ok)
    await screen.findByText('Start local engine completed.')
    expect(desktop.startLocalEngine).toHaveBeenCalledTimes(1)
  })

  it('disables all controls without an Electron bridge', () => {
    vi.mocked(desktop.hasDesktopEngineManager).mockReturnValue(false)
    render(<Controls />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(desktop.getLocalEngineStatus).not.toHaveBeenCalled()
  })

  it('does not disconnect a remote session when managing a local draft', async () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual' })
    await open()
    vi.mocked(desktop.getLocalEngineStatus).mockResolvedValue({ result: ok, payload: { running: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Stop local engine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Stop local engine completed.')
    expect(useAgentStore.getState().connected).toBe(true)
  })
})
