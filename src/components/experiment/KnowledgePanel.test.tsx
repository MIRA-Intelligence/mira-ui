import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { KnowledgePanel } from './KnowledgePanel'
import { useSettingsStore } from '@/stores/settingsStore'

describe('KnowledgePanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: 'en' })
  })

  it('renders the empty state with no knowledge', () => {
    render(<KnowledgePanel knowledge={[]} />)
    expect(screen.getByText('No knowledge accumulated yet', { exact: false })).toBeInTheDocument()
  })

  it('renders the core question and knowledge items', () => {
    render(<KnowledgePanel knowledge={['k1', 'k2']} coreQuestion="Core?" />)
    expect(screen.getByText('Core?')).toBeInTheDocument()
    expect(screen.getByText('k1')).toBeInTheDocument()
    expect(screen.getByText('k2')).toBeInTheDocument()
  })
})
