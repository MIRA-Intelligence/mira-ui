import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TextView } from './TextView'

describe('TextView', () => {
  it('renders numbered lines and a line count', () => {
    render(<TextView text={'a\nb\nc'} />)
    expect(screen.getByText('3 lines')).toBeInTheDocument()
    // line-number gutter renders the index for each row
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders a plain code block when line numbers are disabled', () => {
    const { container } = render(<TextView text={'x\ny'} showLineNumbers={false} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('x\ny')
  })

  it('truncates beyond maxLines and shows the truncated label', () => {
    render(<TextView text={'a\nb\nc\nd'} maxLines={2} truncatedLabel="cut!" />)
    expect(screen.getByText('2 lines')).toBeInTheDocument()
    expect(screen.getByText('cut!')).toBeInTheDocument()
  })
})
