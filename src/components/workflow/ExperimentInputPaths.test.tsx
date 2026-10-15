import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ExperimentInputPaths } from './ExperimentInputPaths'
import { validateDataPath, type DataPathValidationResult } from '@/services/api'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/api', () => ({ validateDataPath: vi.fn() }))

function Harness() {
  const [paths, setPaths] = useState([''])
  const [valid, setValid] = useState(true)
  return <>
    <ExperimentInputPaths paths={paths} onChange={setPaths} onValidChange={setValid} />
    <button disabled={!valid}>Start</button>
  </>
}

beforeEach(() => {
  vi.resetAllMocks()
  useSettingsStore.setState({ language: 'en', runtimeConfig: null })
})

it('blocks unreadable inputs and allows removal without requiring any input', async () => {
  vi.mocked(validateDataPath).mockResolvedValue({ ok: false, error: 'path not found' })
  render(<Harness />)
  expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/missing' } })
  expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  await screen.findByText('path not found')
  expect(validateDataPath).toHaveBeenCalledWith('/missing', 'experiment_input')
  fireEvent.click(screen.getByRole('button', { name: 'Remove path 1' }))
  expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it.each([{ outside_workspace: false, restrict_to_workspace: true },
  { outside_workspace: true, restrict_to_workspace: false }])('does not warn unnecessarily: %j', async (flags) => {
  vi.mocked(validateDataPath).mockResolvedValue({ ok: true, ...flags })
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/data' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('ignores stale validation replies after a path changes', async () => {
  let finish!: (value: DataPathValidationResult) => void
  vi.mocked(validateDataPath).mockImplementation((path) => path === '/old'
    ? new Promise((resolve) => { finish = resolve })
    : Promise.resolve({ ok: false, error: 'new path denied' }))
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/old' } })
  await waitFor(() => expect(validateDataPath).toHaveBeenCalledWith('/old', 'experiment_input'))
  fireEvent.change(screen.getByLabelText('Additional input path 1'), { target: { value: '/new' } })
  await screen.findByText('new path denied')
  await act(async () => { finish({ ok: true, outside_workspace: true, restrict_to_workspace: true }) })
  expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('new path denied')
})
