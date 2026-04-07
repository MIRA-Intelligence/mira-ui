import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import { StatusBar } from './StatusBar'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()

describe('StatusBar', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)

    useProjectStore.setState({
      stats: {
        experiments: 3,
        completed: 1,
        running: 1,
        failed: 0,
      },
    })
    useSettingsStore.setState({
      language: 'en',
      engineStatus: 'compatible',
      engineMessage: null,
    })
  })

  it('renders in strict mode without crashing', () => {
    expect(() => {
      render(
        <StrictMode>
          <StatusBar />
        </StrictMode>,
      )
    }).not.toThrow()

    expect(screen.getByText('Experiments')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('shows compatibility warning when engine is unreachable', () => {
    useSettingsStore.setState({
      engineStatus: 'unreachable',
      engineMessage: 'Engine is unreachable.',
    })
    render(<StatusBar />)

    expect(screen.getByText('Engine is unreachable.')).toBeInTheDocument()
  })
})
