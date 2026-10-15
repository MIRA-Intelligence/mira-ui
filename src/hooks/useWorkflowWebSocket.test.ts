import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/services/workflowWebsocket', () => ({ workflowWsClient: {
  onMessage: vi.fn(() => () => {}), subscribe: vi.fn(), stop: vi.fn(),
} }))
import { useWorkflowWebSocket } from './useWorkflowWebSocket'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { WorkflowSnapshot } from '@/types'

afterEach(() => vi.restoreAllMocks())

it('refreshes the experiment projection on initial snapshot and every durable workflow update', () => {
  useWorkflowStore.getState().clear()
  useProjectStore.setState({ appMode: 'project', selectedTaskId: 'project' })
  useSettingsStore.setState({ engineStatus: 'compatible' })
  vi.spyOn(useWorkflowStore.getState(), 'loadProject').mockResolvedValue()
  const refresh = vi.spyOn(useProjectStore.getState(), 'refreshPlan').mockResolvedValue()
  renderHook(useWorkflowWebSocket)
  const snapshot = { project_sequence: 1 } as WorkflowSnapshot
  act(() => useWorkflowStore.setState({ snapshots: { project: snapshot } }))
  expect(refresh).toHaveBeenCalledWith('project')
  act(() => useWorkflowStore.setState({ snapshots: { project: { ...snapshot, project_sequence: 2 } } }))
  expect(refresh).toHaveBeenCalledTimes(2)
  act(() => useWorkflowStore.setState({ activityByRun: { run: 'Still working' } }))
  expect(refresh).toHaveBeenCalledTimes(2)
})
