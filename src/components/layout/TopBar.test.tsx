import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { TopBar } from './TopBar'
import { useProjectStore } from '@/stores/projectStore'

const initialProjectState = useProjectStore.getState()
const originalElectronApi = window.electronAPI

describe('TopBar', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useProjectStore.setState({
      tasks: [{
        id: 'PRJ-0001',
        label: 'PRJ-0001',
        status: 'pending',
        title: 'Desktop Drag Test',
        coreQuestion: 'demo',
        currentExperiment: 'Exp001',
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: new Date().toISOString(),
      }],
      selectedTaskId: 'PRJ-0001',
      startedAt: Date.now(),
    })
    window.electronAPI = originalElectronApi
  })

  it('marks top bar as draggable on macOS desktop', () => {
    window.electronAPI = { platform: 'darwin' }
    const { container } = render(<TopBar />)
    const header = container.querySelector('header')

    expect(header?.getAttribute('data-drag-region')).toBe('drag')
    expect(container.textContent).toContain('Desktop Drag Test')
  })

  it('does not enable drag region on non-mac platforms', () => {
    window.electronAPI = { platform: 'win32' }
    const { container } = render(<TopBar />)
    const header = container.querySelector('header')

    expect(header?.getAttribute('data-drag-region')).toBe('none')
  })
})
