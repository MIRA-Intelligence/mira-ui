import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalEngineUpdateModal } from './LocalEngineUpdateModal'
import { useSettingsStore } from '@/stores/settingsStore'

const initial = useSettingsStore.getState()

describe('LocalEngineUpdateModal', () => {
  beforeEach(() => {
    useSettingsStore.setState(initial, true)
  })

  it('renders nothing unless a local-bundle update is in progress', () => {
    useSettingsStore.setState({ deploymentMode: 'remoteManual' } as never)
    const { container } = render(<LocalEngineUpdateModal />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the in-progress update state', () => {
    useSettingsStore.setState({
      deploymentMode: 'localBundle',
      localEngineOperation: 'update',
      localEnginePhase: 'updating',
      engineMessage: 'pulling wheels',
      localEngineExecutablePath: '/usr/local/bin/mira',
    } as never)
    render(<LocalEngineUpdateModal />)
    expect(screen.getByText('Updating local engine')).toBeInTheDocument()
    expect(screen.getByText('pulling wheels')).toBeInTheDocument()
    expect(screen.getByText(/usr\/local\/bin\/mira/)).toBeInTheDocument()
  })

  it('shows the failed state and opens settings', () => {
    const openSettings = vi.fn()
    useSettingsStore.setState({
      deploymentMode: 'localBundle',
      localEngineOperation: 'update',
      localEnginePhase: 'error',
      openSettings,
    } as never)
    render(<LocalEngineUpdateModal />)
    expect(screen.getByText('Local engine update failed')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open settings'))
    expect(openSettings).toHaveBeenCalled()
  })
})
