import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DeleteConfirmDialog } from './DeleteConfirmDialog'

describe('DeleteConfirmDialog', () => {
  it('renders the project label and id', () => {
    render(
      <DeleteConfirmDialog projectId="PRJ-1" projectLabel="My Project" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByText(/PRJ-1/)).toBeInTheDocument()
    expect(screen.getByText('Remove from UI')).toBeInTheDocument()
  })

  it('invokes onCancel', () => {
    const onCancel = vi.fn()
    render(
      <DeleteConfirmDialog projectId="PRJ-1" projectLabel="P" onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('confirms with deleteFiles=false by default and true after toggling', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteConfirmDialog projectId="PRJ-1" projectLabel="P" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('Remove from UI'))
    expect(onConfirm).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('Delete All')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Delete All'))
    expect(onConfirm).toHaveBeenLastCalledWith(true)
  })
})
