import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectQueue } from './ProjectQueue'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialUiState = useUiStore.getState()

describe('ProjectQueue mode switch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useUiStore.setState(initialUiState, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('hides manual and auto controls in normal mode', () => {
    useProjectStore.setState({ appMode: 'normal', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument()
  })

  it('shows manual and auto controls in project mode', () => {
    useProjectStore.setState({ appMode: 'project', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.getByRole('button', { name: 'Manual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument()
  })
})
