import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FullScreenPage } from './FullScreenPage'

describe('FullScreenPage', () => {
  afterEach(() => {
    window.electronAPI = undefined as unknown as typeof window.electronAPI
  })

  it('on macOS keeps a draggable strip for the traffic lights and opts the content out', () => {
    window.electronAPI = { platform: 'darwin' } as typeof window.electronAPI
    render(<FullScreenPage><button type="button">Close</button></FullScreenPage>)
    expect(screen.getByTestId('title-bar-strip')).toHaveAttribute('data-drag-region', 'drag')
    expect(screen.getByRole('button', { name: 'Close' }).closest('[data-drag-region]')).toHaveAttribute('data-drag-region', 'no-drag')
  })

  it.each(['win32', 'linux'])('adds nothing on %s, which keeps the native title bar', (platform) => {
    window.electronAPI = { platform } as typeof window.electronAPI
    render(<FullScreenPage><button type="button">Close</button></FullScreenPage>)
    expect(screen.queryByTestId('title-bar-strip')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' }).closest('[data-drag-region]')).toBeNull()
  })
})
