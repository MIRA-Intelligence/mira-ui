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

  it('renders contract checklist and scientific evidence fields', () => {
    useProjectStore.setState({
      tasks: [{
        id: 'PRJ-0001',
        label: 'PRJ-0001',
        status: 'in_progress',
        title: 'Demo',
        coreQuestion: 'demo',
        runMode: 'auto',
        agentProfile: 'research',
        contractVersion: 2,
        currentExperiment: 'Exp007c',
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: new Date().toISOString(),
      }],
      selectedTaskId: 'PRJ-0001',
      contractsByTask: {
        'PRJ-0001': {
          profile: 'research',
          contract_version: 2,
          required_completed_fields: ['theoretical_proof', 'evidence_refs'],
          required_falsify_fields: ['isolation_test.control'],
          falsify_keywords: ['falsif'],
        },
      },
    })
    render(
      <ExperimentDetail
        experiment={{
          id: 'Exp007c',
          title: 'Normalization Ablation: SNR',
          status: 'completed',
          conclusion: 'HYPOTHESIS FALSIFIED due to lower correlation.',
          theoretical_proof: 'CRLB is inversely proportional to SNR.',
          isolation_test: {
            treatment: 'per-sample SNR normalization',
          },
          evidence_refs: [{ ref_id: 'R2', relevance: 'Physics-informed preprocessing' }],
        }}
      />,
    )

    expect(screen.getByText('Theoretical Proof')).toBeInTheDocument()
    expect(screen.getByText('CRLB is inversely proportional to SNR.')).toBeInTheDocument()
    expect(screen.getByText('Evidence References')).toBeInTheDocument()
    expect(screen.getByText('Contract Requirements')).toBeInTheDocument()
    expect(screen.getByText(/theoretical_proof/)).toBeInTheDocument()
    expect(screen.getByText(/isolation_test.control/)).toBeInTheDocument()
  })
})
