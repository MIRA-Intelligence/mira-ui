import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { NewProjectModal } from './NewProjectModal'
import { useUiStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'

const initialUiState = useUiStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialAgentState = useAgentStore.getState()

describe('NewProjectModal', () => {
  beforeEach(() => {
    useUiStore.setState(initialUiState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useAgentStore.setState(initialAgentState, true)

    useProjectStore.setState({ projectsLoaded: true })
    useAgentStore.setState({ connected: true })
    useSettingsStore.setState({ language: 'en' })
  })

  it('toggles closed/open without hook-order runtime errors', () => {
    render(
      <StrictMode>
        <NewProjectModal />
      </StrictMode>,
    )

    expect(screen.queryByText('New Research Project')).not.toBeInTheDocument()

    act(() => {
      useUiStore.setState({ newProjectOpen: true })
    })
    expect(screen.getByText('New Research Project')).toBeInTheDocument()

    act(() => {
      useUiStore.setState({ newProjectOpen: false })
    })
    expect(screen.queryByText('New Research Project')).not.toBeInTheDocument()
  })
})
