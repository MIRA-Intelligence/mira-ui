import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { RevisionsPanel } from './RevisionsPanel'
import { useSettingsStore } from '@/stores/settingsStore'
import type { PlanRevision } from '@/types'

const initialSettingsState = useSettingsStore.getState()

describe('RevisionsPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialSettingsState, true)
    useSettingsStore.setState({ language: 'en' })
  })

  it('renders an empty state when there are no revisions', () => {
    render(<RevisionsPanel revisions={[]} />)
    expect(screen.getByText('No plan revisions yet.')).toBeInTheDocument()
  })

  it('renders revisions newest-first with action, target and rationale', () => {
    const revisions: PlanRevision[] = [
      {
        action: 'add',
        target: 'Exp003',
        rationale: 'Verify the blur anomaly',
        sourceExperiment: 'Exp001',
        at: '2026-06-10T00:00:00Z',
      },
      {
        action: 'skip',
        target: 'Exp002',
        rationale: 'Now redundant',
        at: '2026-06-10T01:00:00Z',
      },
    ]
    render(<RevisionsPanel revisions={revisions} />)

    expect(screen.getByText('Added experiment')).toBeInTheDocument()
    expect(screen.getByText('Skipped experiment')).toBeInTheDocument()
    expect(screen.getByText('Exp003')).toBeInTheDocument()
    expect(screen.getByText('Verify the blur anomaly')).toBeInTheDocument()
    expect(screen.getByText('Exp001')).toBeInTheDocument()

    // Newest first: the 'skip' (later timestamp) should appear before 'add'.
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Skipped experiment')
    expect(items[1]).toHaveTextContent('Added experiment')
  })
})
