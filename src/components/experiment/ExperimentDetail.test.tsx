import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ExperimentDetail } from './ExperimentDetail'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()

describe('ExperimentDetail snapshot toggle', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useProjectStore.setState({ selectedTaskId: 'PRJ-0001' })
    useSettingsStore.setState({ language: 'en' })
  })

  it('switches between live and snapshot content', () => {
    render(
      <ExperimentDetail
        experiment={{
          id: 'Exp001',
          title: 'Live title',
          status: 'completed',
          results: {
            findings: 'Live findings',
          },
          conclusion: 'Live conclusion',
          snapshot: {
            title: 'Snapshot title',
            results: {
              findings: 'Snapshot findings',
            },
            conclusion: 'Snapshot conclusion',
          },
        }}
      />,
    )

    expect(screen.getByText('Live conclusion')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Snapshot' })
    fireEvent.click(toggle)
    expect(screen.getByText('Snapshot conclusion')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument()
  })
})
