import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentPanel } from './AgentPanel'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'

const initialAgentState = useAgentStore.getState()
const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()

describe('AgentPanel keyboard behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAgentStore.setState(initialAgentState, true)
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)

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

  it('keeps Enter as newline and sends on Shift+Enter', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    render(<AgentPanel />)

    const textarea = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(textarea, { target: { value: 'hello world' } })

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })
    let payloads = sendSpy.mock.calls.map((call) => call[0])
    expect(payloads.filter((p) => p?.type === 'message')).toHaveLength(0)

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true })
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
  })

  it('sends normal chat messages without a selected project', () => {
    const sendSpy = vi.spyOn(wsClient, 'send').mockImplementation(() => {})
    useProjectStore.setState({
      appMode: 'normal',
      selectedTaskId: null,
      mode: 'manual',
      agentProfile: 'research',
    })
    useAgentStore.setState({ logsByProject: {} })

    render(<AgentPanel />)

    const textarea = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(textarea, { target: { value: 'general question' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true })

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: 'general question',
      session_id: '__normal__',
      loop_mode: 'normal',
    }))
    expect(sendSpy.mock.calls[0]?.[0]).not.toHaveProperty('agent_profile')
  })
})
