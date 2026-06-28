import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UpdateBanner } from './UpdateBanner'
import { useUiStore } from '@/stores/uiStore'

type ElectronApi = NonNullable<Window['electronAPI']>

function setElectronApi(api: Partial<ElectronApi> | undefined): void {
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true, writable: true })
}

const uiInitial = useUiStore.getState()

const update = {
  version: '2.0.0',
  tagName: 'v2.0.0',
  name: 'Version 2.0.0',
  url: 'https://example.com/release',
  isPrerelease: false,
} as never

describe('UpdateBanner', () => {
  beforeEach(() => {
    setElectronApi(undefined)
    useUiStore.setState(uiInitial, true)
  })
  afterEach(() => {
    setElectronApi(undefined)
    vi.restoreAllMocks()
  })

  it('renders nothing when there is no update', () => {
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the banner is dismissed', () => {
    useUiStore.setState({ availableUpdate: update, updateBannerDismissed: true })
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('opens the release page via window.open when no electron bridge', () => {
    useUiStore.setState({ availableUpdate: update, updateBannerDismissed: false })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { getByText } = render(<UpdateBanner />)
    fireEvent.click(getByText('Version 2.0.0', { exact: false }).closest('div')!.parentElement!.querySelector('button')!)
    expect(openSpy).toHaveBeenCalledWith('https://example.com/release', '_blank', 'noopener,noreferrer')
  })

  it('uses the electron bridge for download and skip', () => {
    const openReleasePage = vi.fn()
    const skipUpdateVersion = vi.fn()
    setElectronApi({ openReleasePage, skipUpdateVersion } as unknown as Partial<ElectronApi>)
    useUiStore.setState({ availableUpdate: update, updateBannerDismissed: false })

    const { getAllByRole } = render(<UpdateBanner />)
    const buttons = getAllByRole('button')
    // [download, later, skip]
    fireEvent.click(buttons[0])
    expect(openReleasePage).toHaveBeenCalledWith('https://example.com/release')

    fireEvent.click(buttons[2])
    expect(skipUpdateVersion).toHaveBeenCalledWith('2.0.0')
    expect(useUiStore.getState().availableUpdate).toBeNull()
  })

  it('"Later" dismisses the banner for the session', () => {
    setElectronApi(undefined)
    useUiStore.setState({ availableUpdate: update, updateBannerDismissed: false })
    const { getAllByRole } = render(<UpdateBanner />)
    fireEvent.click(getAllByRole('button')[1])
    expect(useUiStore.getState().updateBannerDismissed).toBe(true)
  })
})
