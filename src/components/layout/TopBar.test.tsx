import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TopBar } from './TopBar'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialProjectState = useProjectStore.getState()
const originalElectronApi = window.electronAPI

describe('TopBar', () => {
  beforeEach(() => {
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState({ engineStartedAt: null })
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

  it('keeps feedback button clickable inside macOS drag region', () => {
    window.electronAPI = { platform: 'darwin' }
    render(<TopBar />)

    const button = screen.getByRole('button', { name: /feedback|提交反馈/i })
    expect(button.getAttribute('data-drag-region')).toBe('no-drag')
  })

  it('does not enable drag region on non-mac platforms', () => {
    window.electronAPI = { platform: 'win32' }
    const { container } = render(<TopBar />)
    const header = container.querySelector('header')

    expect(header?.getAttribute('data-drag-region')).toBe('none')
  })

  it('shows a placeholder when no engine is running', () => {
    useSettingsStore.setState({ engineStartedAt: null })
    const { container } = render(<TopBar />)
    expect(container.textContent).toContain('T+ --:--:--')
  })

  it('renders the engine running time from the engine boot timestamp', () => {
    useSettingsStore.setState({ engineStartedAt: Date.now() - 65_000 })
    const { container } = render(<TopBar />)
    expect(container.textContent).toMatch(/T\+ 00:01:0\d/)
  })
})
