import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ExperimentTimeline } from './ExperimentTimeline'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Experiment } from '@/types'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()

function setTask(experiments: Experiment[]) {
  useProjectStore.setState({
    tasks: [{
      id: 'PRJ-0001',
      label: 'PRJ-0001',
      status: 'in_progress',
      title: 'Demo',
      coreQuestion: 'demo',
      runMode: 'auto',
      agentProfile: 'team',
      contractVersion: 1,
      currentExperiment: experiments[0]?.id ?? null,
      experiments,
      knowledge: [],
      research: { references: [], notes: [] },
      result: {},
      startedAt: new Date().toISOString(),
    }],
    selectedTaskId: 'PRJ-0001',
  })
}

describe('ExperimentTimeline guard warning marker', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('shows a red "!" marker with tooltip when an experiment has guard warnings', () => {
    setTask([
      {
        id: 'Exp010',
        title: 'LOVO stress test',
        status: 'completed',
        guard_warnings: ["artifact path does not exist 'x_*.csv'"],
      },
    ])

    render(<ExperimentTimeline />)

    const marker = screen.getByLabelText('guard-warning')
    expect(marker).toHaveTextContent('!')
    expect(marker).toHaveAttribute('title', expect.stringContaining('does not exist'))
  })

  it('does not show a marker when there are no guard warnings', () => {
    setTask([
      { id: 'Exp001', title: 'Clean experiment', status: 'completed' },
    ])

    render(<ExperimentTimeline />)

    expect(screen.queryByLabelText('guard-warning')).toBeNull()
  })
})
