import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ResearchView } from './ResearchView'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { ResearchData, WorkflowSnapshot } from '@/types'

describe('ResearchView', () => {
  beforeEach(() => {
    useWorkflowStore.getState().clear()
    useAgentStore.setState({ logsByProject: {} })
    useProjectStore.setState({ selectedTaskId: null })
  })

  it('shows the empty state when there is no research data', () => {
    const data: ResearchData = { references: [], notes: [] }
    render(<ResearchView data={data} />)
    // empty-state emoji block renders
    expect(screen.getByText('📚')).toBeInTheDocument()
  })

  it('renders the core question, survey, references and notes', () => {
    const data: ResearchData = {
      survey: 'A short survey overview.',
      notes: ['note one', 'note two'],
      references: [
        {
          id: '1',
          title: 'Deep Learning',
          authors: 'LeCun',
          year: '2015',
          venue: 'Nature',
          url: 'https://example.com',
          summary: 'A landmark review.',
          relevance: 'highly relevant',
        },
        { id: '2', title: 'No URL Paper' },
      ],
    }
    render(<ResearchView data={data} coreQuestion="What drives generalization?" />)

    expect(screen.getByText('What drives generalization?')).toBeInTheDocument()
    expect(screen.getByText('A short survey overview.')).toBeInTheDocument()
    expect(screen.getByText('note one')).toBeInTheDocument()
    expect(screen.getByText('note two')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Deep Learning' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByText('No URL Paper')).toBeInTheDocument()
    expect(screen.getByText('A landmark review.')).toBeInTheDocument()
    expect(screen.getByText(/LeCun · Nature · 2015/)).toBeInTheDocument()
  })

  it('renders the selected initiation Run configuration and assistant research record', () => {
    const workflow: WorkflowSnapshot = {
      workflow_contract_version: 1,
      project_id: 'PRJ-1',
      project_sequence: 1,
      workflow: {
        contract_version: 1,
        status: 'active',
        revision: 1,
        last_project_sequence: 1,
        selected_run_id: 'run-1',
        handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
      },
      runs: [{
        schema_version: 1,
        workflow_contract_version: 1,
        run_id: 'run-1',
        project_id: 'PRJ-1',
        module_type: 'initiation',
        label: 'Initiation 1',
        status: 'running',
        revision: 1,
        created_at: '2026-07-23T00:00:00Z',
        updated_at: '2026-07-23T00:00:00Z',
        inputs: [],
        outputs: [],
        attempt: { number: 1 },
        attempts: [],
        conversation_key: 'ui:PRJ-1:run:run-1',
        last_project_sequence: 1,
        last_run_sequence: 1,
        module_data: {
          intent: 'Review the evidence',
          literature_review: { enabled: true, sources: ['pubmed', 'arxiv'] },
          references: 'doi:10.1000/example',
          research_result: {
            schema_version: 1,
            survey: 'A structured survey from the initiation Run.',
            references: [{
              id: 'ref-1',
              title: 'AI fibrosis staging',
              authors: 'Example et al.',
              year: '2025',
              source: 'PubMed',
              venue: 'Radiology',
              url: 'https://doi.org/10.1000/example',
              doi: '10.1000/example',
              summary: 'A multicenter validation study.',
              relevance: 'Directly evaluates the target task.',
            }],
            searches: [{
              source: 'pubmed',
              query: 'liver fibrosis AND artificial intelligence',
              status: 'completed',
              result_count: 8,
              evidence_urls: ['https://pubmed.ncbi.nlm.nih.gov/12345678/'],
              searched_at: '2026-07-23T00:30:00Z',
            }],
            notes: ['External validation remains limited.'],
            gaps: ['No prospective head-to-head comparison.'],
            directions: [{
              id: 'direction-1',
              title: 'Prospective multimodal validation',
              rationale: 'Addresses external validity.',
              tradeoffs: 'Higher recruitment cost.',
              next_step: 'Define sites and endpoints.',
            }],
          },
        },
      }],
    }
    useProjectStore.setState({ selectedTaskId: 'PRJ-1' })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': workflow },
      selectedRunByProject: { 'PRJ-1': 'run-1' },
    })
    useAgentStore.setState({
      logsByProject: {
        'PRJ-1:run:run-1': [{
          id: 'assistant-research',
          timestamp: '2026-07-23T01:00:00Z',
          content: '## Evidence synthesis\nPaper A supports the primary hypothesis.',
          type: 'response',
          metadata: {},
        }],
      },
    })

    render(<ResearchView data={{ references: [], notes: [] }} />)

    expect(screen.getByText('Literature research configuration')).toBeInTheDocument()
    expect(screen.getByText(/PubMed, arXiv/)).toBeInTheDocument()
    expect(screen.getByText(/doi:10.1000\/example/)).toBeInTheDocument()
    expect(screen.getByText('A structured survey from the initiation Run.')).toBeInTheDocument()
    expect(screen.getByText('Search evidence')).toBeInTheDocument()
    expect(screen.getByText('liver fibrosis AND artificial intelligence')).toBeInTheDocument()
    expect(screen.getByText('8 results')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Evidence 1' })).toHaveAttribute(
      'href',
      'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    )
    expect(
      screen.getByText('A structured survey from the initiation Run.').compareDocumentPosition(
        screen.getByText('Search evidence'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'AI fibrosis staging' })).toBeInTheDocument()
    expect(screen.getByText('DOI: 10.1000/example')).toBeInTheDocument()
    expect(screen.getByText('External validation remains limited.')).toBeInTheDocument()
    expect(screen.getByText('No prospective head-to-head comparison.')).toBeInTheDocument()
    expect(screen.getByText('Prospective multimodal validation')).toBeInTheDocument()
    expect(screen.getByText(/Higher recruitment cost/)).toBeInTheDocument()
    expect(screen.getByText(/Define sites and endpoints/)).toBeInTheDocument()
    expect(screen.getByText('Process audit log')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence synthesis' })).toBeInTheDocument()
    expect(screen.getByText(/Paper A supports/)).toBeInTheDocument()
  })
})
