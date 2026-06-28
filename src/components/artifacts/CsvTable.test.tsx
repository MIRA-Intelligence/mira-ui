import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CsvTable } from './CsvTable'

describe('CsvTable', () => {
  it('renders an empty-file message for blank input', () => {
    render(<CsvTable text="" />)
    expect(screen.getByText('Empty file.')).toBeInTheDocument()
  })

  it('renders headers, body rows and a row/column summary', () => {
    render(<CsvTable text={'name,age\nAlice,30\nBob,25'} />)
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('2 rows · 2 columns')).toBeInTheDocument()
  })

  it('uses singular labels for a single row/column', () => {
    render(<CsvTable text={'only\nx'} />)
    expect(screen.getByText('1 row · 1 column')).toBeInTheDocument()
  })

  it('shows the overflow label when there are more than 1000 body rows', () => {
    const rows = ['h']
    for (let i = 0; i < 1005; i++) rows.push(`v${i}`)
    render(<CsvTable text={rows.join('\n')} truncatedLabel="too many" />)
    expect(screen.getByText('too many')).toBeInTheDocument()
  })
})
