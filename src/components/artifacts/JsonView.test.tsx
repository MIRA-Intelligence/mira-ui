import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { JsonView } from './JsonView'

describe('JsonView', () => {
  it('renders an object with primitive children', () => {
    render(<JsonView text={'{"name":"Alice","age":30,"active":true,"nickname":null}'} />)
    expect(screen.getByText('"name":')).toBeInTheDocument()
    expect(screen.getByText('"Alice"')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('null')).toBeInTheDocument()
  })

  it('parses NDJSON when the text is not a single document', () => {
    render(<JsonView text={'{"a":1}\n{"a":2}'} />)
    expect(screen.getByText(/Parsed as NDJSON \(2 records\)/)).toBeInTheDocument()
  })

  it('shows an error for invalid JSON lines', () => {
    render(<JsonView text={'{"a":1}\nnot-json'} />)
    expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument()
  })

  it('collapses deep nodes and toggles on click', () => {
    // depth 0 expanded, nested object at depth 1 collapsed when defaultExpandDepth=1
    render(<JsonView text={'{"outer":{"inner":1}}'} defaultExpandDepth={1} />)
    const summary = screen.getByText('{ 1 keys }')
    expect(summary).toBeInTheDocument()
    // expand the collapsed node
    const toggles = screen.getAllByRole('button')
    fireEvent.click(toggles[toggles.length - 1])
    expect(screen.getByText('"inner":')).toBeInTheDocument()
  })

  it('renders arrays with indexes', () => {
    render(<JsonView text={'[10,20]'} />)
    expect(screen.getByText('0:')).toBeInTheDocument()
    expect(screen.getByText('1:')).toBeInTheDocument()
  })
})
