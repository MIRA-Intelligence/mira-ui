import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentPanel } from './AgentPanel'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialChatState = useChatStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialSkillPluginsState = useSkillPluginsStore.getState()

describe('AgentPanel keyboard behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
    useChatStore.setState(initialChatState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useSkillPluginsStore.setState(initialSkillPluginsState, true)

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

  it('shows the AUTO badge when project mode is on auto', () => {
    useProjectStore.setState({
      appMode: 'project',
      selectedTaskId: 'PRJ-0001',
      mode: 'auto',
      agentProfile: 'research',
    })

    render(<AgentPanel />)

    expect(screen.getByText('AUTO')).toBeInTheDocument()
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
