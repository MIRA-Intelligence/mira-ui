import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ResearchView } from './ResearchView'
import type { ResearchData } from '@/types'

describe('ResearchView', () => {
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
})
