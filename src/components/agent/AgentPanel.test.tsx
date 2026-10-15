import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentPanel } from './AgentPanel'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkflowStore } from '@/stores/workflowStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialChatState = useChatStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialSkillPluginsState = useSkillPluginsStore.getState()
const initialUiState = useUiStore.getState()
const initialWorkflowState = useWorkflowStore.getState()

describe('AgentPanel keyboard behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
    useChatStore.setState(initialChatState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useSkillPluginsStore.setState(initialSkillPluginsState, true)
    useUiStore.setState(initialUiState, true)
    useWorkflowStore.setState(initialWorkflowState, true)

    useSettingsStore.setState({ language: 'en' })
    useProjectStore.setState({
      selectedTaskId: 'PRJ-0001',
      mode: 'manual',
      agentProfile: 'research',
    })
    useAgentStore.setState({
      connected: true,
      logsByProject: {
        'PRJ-0001': [
          {
            id: 'seed-log',
            timestamp: new Date().toISOString(),
            content: 'history',
            type: 'response',
            metadata: {},
          },
        ],
      },
    })
  })

  it('sends on Enter and keeps Shift+Enter for newline by default', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    render(<AgentPanel />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'hello world' } })

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true })
    let payloads = sendSpy.mock.calls.map((call) => call[0])
    expect(payloads.filter((p) => p?.type === 'message')).toHaveLength(0)

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })
    expect(sendSpy).toHaveBeenCalled()
    payloads = sendSpy.mock.calls.map((call) => call[0])
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          content: 'hello world',
          session_id: 'PRJ-0001',
        }),
      ]),
    )
    expect((textarea as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText('Mira is thinking...')).toBeInTheDocument()
  })

  it('starts at button height and exposes an upward resize handle', () => {
    render(<AgentPanel />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('h-10', 'min-h-10')
    expect(textarea).toHaveAttribute('rows', '1')
    expect(screen.getByRole('button', { name: 'Drag upward to expand the input' })).toHaveClass('cursor-ns-resize')
  })

  it('supports the legacy Shift+Enter send shortcut', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    useSettingsStore.setState({ sendShortcut: 'shift_enter' })
    render(<AgentPanel />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'legacy shortcut' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })
    expect(sendSpy.mock.calls.filter(([payload]) => payload.type === 'message')).toHaveLength(0)
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: 'legacy shortcut',
    }))
  })

  it('sends an explicit stop control message and waits for acknowledgement', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    render(<AgentPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stop',
      session_id: 'PRJ-0001',
      request_id: expect.any(String),
    }))
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()

    act(() => {
      useAgentStore.getState().handleWsMessage({
        type: 'stop_ack',
        session_id: 'PRJ-0001',
        content: 'Stopped 1 task(s).',
      })
    })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('sends selected Skills as structured message metadata', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    useSkillPluginsStore.setState({
      load: vi.fn(async () => {}),
      plugins: [{
        id: 'custom',
        name: 'Custom',
        version: '1',
        description: '',
        install_path: '/skills',
        source: { type: 'directory', path: '/skills' },
        enabled: { global: true, project: null, effective: true },
        groups: [],
        skills: [{
          id: 'mrstation',
          name: 'mrstation',
          path: '/skills/mrstation/SKILL.md',
          group_ids: [],
          enabled: { global: true, project: null, effective: true },
        }],
      }],
    })
    render(<AgentPanel />)

    fireEvent.click(screen.getByRole('button', { name: '$ Skill' }))
    fireEvent.click(screen.getByRole('button', { name: '$mrstation' }))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'analyze this dataset' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      selected_skill_ids: ['mrstation'],
      turn_id: expect.any(String),
    }))
  })

  it('shows the current tool call in the working indicator while streaming', () => {
    useAgentStore.setState({
      streamingBySession: { 'PRJ-0001': true },
      logsByProject: {
        'PRJ-0001': [
          {
            id: 'user-1',
            timestamp: new Date().toISOString(),
            content: 'do it',
            type: 'response',
            metadata: { _user: true },
          },
          {
            id: 'tool-1',
            timestamp: new Date().toISOString(),
            content: 'bg({"cmd": "python train.py"})',
            type: 'tool_call',
            metadata: {},
          },
        ],
      },
    })

    render(<AgentPanel />)

    const currentStep = screen.getByText('Mira is running: bg({"cmd": "python train.py"})')
    expect(currentStep).toBeInTheDocument()
    expect(currentStep).toHaveClass('truncate', 'whitespace-nowrap')
    expect(screen.queryByText('Mira is thinking...')).toBeNull()
  })

  it('condenses and truncates a long current step to one line', () => {
    const rawStep = `python(  "${'x'.repeat(100)}"  )\nnext line`
    const condensedStep = rawStep.replace(/\s+/g, ' ').trim()
    useAgentStore.setState({
      streamingBySession: { 'PRJ-0001': true },
      logsByProject: {
        'PRJ-0001': [
          {
            id: 'progress-1',
            timestamp: new Date().toISOString(),
            content: rawStep,
            type: 'progress',
            metadata: { _tool_hint: true },
          },
        ],
      },
    })

    render(<AgentPanel />)

    const currentStep = screen.getByText(`Mira is running: ${condensedStep.slice(0, 80)}…`)
    expect(currentStep).toHaveClass('truncate', 'whitespace-nowrap')
  })

  it('shows the latest valid tool progress in a normal conversation', () => {
    useChatStore.setState({
      chats: [{ id: 'chat-test', title: '', createdAt: 0, updatedAt: 0 }],
      activeChatId: 'chat-test',
      workspaceKey: 'ws',
    })
    useProjectStore.setState({
      appMode: 'normal',
      selectedTaskId: null,
      mode: 'manual',
      agentProfile: 'research',
    })
    useAgentStore.setState({
      streamingBySession: { 'chat-test': true },
      logsByProject: {
        'chat-test': [
          {
            id: 'user-1',
            timestamp: new Date().toISOString(),
            content: 'inspect this',
            type: 'response',
            metadata: { _user: true },
          },
          {
            id: 'progress-1',
            timestamp: new Date().toISOString(),
            content: 'exec("python inspect.py")',
            type: 'progress',
            metadata: { _tool_hint: true },
          },
          {
            id: 'progress-2',
            timestamp: new Date().toISOString(),
            content: '   ',
            type: 'progress',
            metadata: {},
          },
        ],
      },
    })

    render(<AgentPanel />)

    expect(screen.getByText('Mira is running: exec("python inspect.py")')).toBeInTheDocument()
    expect(screen.queryByText('Mira is thinking...')).toBeNull()
  })

  it('shows the current ModuleRun activity in the project conversation bubble', () => {
    useProjectStore.setState({
      appMode: 'project',
      activeStage: 'result',
    })
    useWorkflowStore.setState({
      selectedRunByProject: { 'PRJ-0001': 'run-delivery' },
      snapshots: {
        'PRJ-0001': {
          workflow_contract_version: 1,
          project_id: 'PRJ-0001',
          project_sequence: 1,
          workflow: {
            contract_version: 1,
            status: 'active',
            revision: 1,
            last_project_sequence: 1,
            selected_run_id: 'run-delivery',
            handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
          },
          runs: [{
            schema_version: 1,
            workflow_contract_version: 1,
            run_id: 'run-delivery',
            project_id: 'PRJ-0001',
            module_type: 'delivery',
            label: 'Delivery 1',
            status: 'running',
            revision: 2,
            created_at: '2026-07-31T00:00:00Z',
            updated_at: '2026-07-31T00:00:01Z',
            inputs: [],
            outputs: [],
            attempt: { number: 1 },
            attempts: [],
            conversation_key: 'ui:PRJ-0001:run:run-delivery',
            last_project_sequence: 1,
            last_run_sequence: 2,
            module_data: {},
          }],
        },
      },
      activityByRun: { 'run-delivery': 'write result/exports/presentation.pdf' },
    })
    useAgentStore.setState({
      streamingBySession: { 'PRJ-0001:run:run-delivery': true },
      logsByProject: {
        'PRJ-0001:run:run-delivery': [{
          id: 'user-run',
          timestamp: new Date().toISOString(),
          content: 'Create the presentation',
          type: 'response',
          metadata: { _user: true },
        }],
      },
    })

    render(<AgentPanel />)

    expect(screen.getByText('Mira is running: write result/exports/presentation.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Mira is thinking...')).toBeNull()
  })

  it('sends quick chat messages on the active chat thread without a project', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    useChatStore.setState({
      chats: [{ id: 'chat-test', title: '', createdAt: 0, updatedAt: 0 }],
      activeChatId: 'chat-test',
      workspaceKey: 'ws',
    })
    useProjectStore.setState({
      appMode: 'normal',
      selectedTaskId: null,
      mode: 'manual',
      agentProfile: 'research',
    })
    useAgentStore.setState({ logsByProject: {} })

    render(<AgentPanel />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'general question' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: 'general question',
      session_id: 'chat-test',
      loop_mode: 'normal',
    }))
    const messageCall = sendSpy.mock.calls
      .map((call) => call[0])
      .find((payload) => payload?.type === 'message')
    expect(messageCall).not.toHaveProperty('agent_profile')
  })

  it('opens project promotion without prefilling the research description', () => {
    useChatStore.setState({
      chats: [{ id: 'chat-promote', title: 'MRI study', createdAt: 0, updatedAt: 0 }],
      activeChatId: 'chat-promote',
      workspaceKey: 'ws',
    })
    useProjectStore.setState({ appMode: 'normal', selectedTaskId: null })
    useAgentStore.setState({ logsByProject: { 'chat-promote': [] } })

    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn into project' }))

    expect(useUiStore.getState()).toMatchObject({
      newProjectOpen: true,
      newProjectFromChatId: 'chat-promote',
    })
    expect(useUiStore.getState()).not.toHaveProperty('newProjectDescriptionPrefill')
  })

  it('does not show a global AUTO badge without an experiment Run', () => {
    useProjectStore.setState({
      appMode: 'project',
      selectedTaskId: 'PRJ-0001',
      mode: 'auto',
      agentProfile: 'research',
    })

    render(<AgentPanel />)

    expect(screen.queryByText('AUTO')).not.toBeInTheDocument()
  })

  it.each(['auto', 'manual'] as const)('shows the selected experiment mode: %s', (mode) => {
    useProjectStore.setState({ appMode: 'project', selectedTaskId: 'PRJ-0001', mode: mode === 'auto' ? 'manual' : 'auto' })
    useWorkflowStore.setState({
      selectedRunByProject: { 'PRJ-0001': 'experiment-run' },
      snapshots: { 'PRJ-0001': { runs: [{ run_id: 'experiment-run', module_type: 'experiment',
        status: 'running', module_data: { experiment_execution_mode: mode } }] } },
    } as never)
    render(<AgentPanel />)
    expect(screen.getByText(mode.toUpperCase())).toBeInTheDocument()
    expect(screen.queryByText(mode === 'auto' ? 'MANUAL' : 'AUTO')).not.toBeInTheDocument()
  })

  it('hides the AUTO badge in normal mode even when mode is still auto', () => {
    // mode may remain "auto" from a prior project session — the badge must
    // not leak into normal chat where the manual/auto toggle is hidden.
    useProjectStore.setState({
      appMode: 'normal',
      selectedTaskId: null,
      mode: 'auto',
      agentProfile: 'research',
    })
    useAgentStore.setState({ logsByProject: {} })

    render(<AgentPanel />)

    expect(screen.queryByText('AUTO')).not.toBeInTheDocument()
  })
})
