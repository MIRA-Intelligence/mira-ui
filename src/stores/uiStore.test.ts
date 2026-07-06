import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENT_PANEL_WIDTH, SIDEBAR_WIDTH, useUiStore } from './uiStore'
import { installLocalStorage } from '@/test/localStorage'

const initialState = useUiStore.getState()

describe('uiStore.systemMessages', () => {
  beforeEach(() => {
    useUiStore.setState(initialState, true)
  })

  it('pushes a system message and returns its id', () => {
    const id = useUiStore.getState().pushSystemMessage('hello')
    expect(id).toMatch(/^sysmsg-/)
    const msgs = useUiStore.getState().systemMessages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('hello')
    expect(msgs[0].severity).toBe('info')
    expect(msgs[0].expiresAt).toBeGreaterThan(Date.now())
  })

  it('honors custom severity and ttl', () => {
    const before = Date.now()
    useUiStore.getState().pushSystemMessage('warn me', { severity: 'warning', ttlMs: 1000 })
    const msg = useUiStore.getState().systemMessages[0]
    expect(msg.severity).toBe('warning')
    expect(msg.expiresAt).toBeGreaterThanOrEqual(before + 999)
    expect(msg.expiresAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('caps the queue length to prevent unbounded growth', () => {
    const push = useUiStore.getState().pushSystemMessage
    for (let i = 0; i < 50; i += 1) push(`msg-${i}`)
    const msgs = useUiStore.getState().systemMessages
    expect(msgs.length).toBeLessThanOrEqual(16)
    expect(msgs[msgs.length - 1].text).toBe('msg-49')
  })

  it('dismisses a message by id', () => {
    const id = useUiStore.getState().pushSystemMessage('to dismiss')
    useUiStore.getState().dismissSystemMessage(id)
    expect(useUiStore.getState().systemMessages).toHaveLength(0)
  })

  it('clears expired messages', () => {
    useUiStore.getState().pushSystemMessage('soon-expired', { ttlMs: 500 })
    useUiStore.getState().pushSystemMessage('still-fresh', { ttlMs: 60_000 })
    useUiStore.getState().clearExpiredSystemMessages(Date.now() + 1000)
    const remaining = useUiStore.getState().systemMessages
    expect(remaining).toHaveLength(1)
    expect(remaining[0].text).toBe('still-fresh')
  })

  it('clearExpiredSystemMessages is a no-op when nothing is expired', () => {
    useUiStore.getState().pushSystemMessage('fresh', { ttlMs: 60_000 })
    const before = useUiStore.getState().systemMessages
    useUiStore.getState().clearExpiredSystemMessages()
    expect(useUiStore.getState().systemMessages).toBe(before)
  })
})

describe('uiStore.layout + modals', () => {
  beforeEach(() => {
    installLocalStorage()
    useUiStore.setState(initialState, true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('toggles and sets sidebar collapse', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
    useUiStore.getState().setSidebarCollapsed(false)
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggles and sets the agent panel collapse', () => {
    useUiStore.getState().toggleAgentPanel()
    expect(useUiStore.getState().agentPanelCollapsed).toBe(true)
    useUiStore.getState().setAgentPanelCollapsed(false)
    expect(useUiStore.getState().agentPanelCollapsed).toBe(false)
  })

  it('clamps and persists the sidebar width', () => {
    useUiStore.getState().setSidebarWidth(SIDEBAR_WIDTH.max + 1000)
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.max)
    expect(localStorage.getItem('mira:ui:sidebarWidth')).toBe(String(SIDEBAR_WIDTH.max))
  })

  it('clamps a non-finite agent panel width to the minimum', () => {
    useUiStore.getState().setAgentPanelWidth(Number.NaN)
    expect(useUiStore.getState().agentPanelWidth).toBe(AGENT_PANEL_WIDTH.min)
  })

  it('opens and closes the new-project modal with prefill', () => {
    useUiStore.getState().openNewProject({ prefill: 'seed', fromChatId: 'chat-1' })
    expect(useUiStore.getState()).toMatchObject({
      newProjectOpen: true,
      newProjectPrefill: 'seed',
      newProjectFromChatId: 'chat-1',
    })
    useUiStore.getState().closeNewProject()
    expect(useUiStore.getState()).toMatchObject({
      newProjectOpen: false,
      newProjectPrefill: null,
      newProjectFromChatId: null,
    })
  })

  it('opens and closes the skills/plugins modal', () => {
    useUiStore.getState().openSkillsPlugins()
    expect(useUiStore.getState().skillsPluginsOpen).toBe(true)
    useUiStore.getState().closeSkillsPlugins()
    expect(useUiStore.getState().skillsPluginsOpen).toBe(false)
  })

  it('manages available update + banner dismissal', () => {
    const info = { version: '9.9.9', notes: '', url: '' } as never
    useUiStore.getState().setAvailableUpdate(info)
    expect(useUiStore.getState().availableUpdate).toBe(info)
    expect(useUiStore.getState().updateBannerDismissed).toBe(false)
    useUiStore.getState().dismissUpdateBanner()
    expect(useUiStore.getState().updateBannerDismissed).toBe(true)
    useUiStore.getState().resetUpdateBannerDismissed()
    expect(useUiStore.getState().updateBannerDismissed).toBe(false)
  })
})

describe('uiStore.quickChatLayout', () => {
  beforeEach(() => {
    useUiStore.setState(initialState, true)
  })

  it('focusQuickChatWorkbench collapses center and expands the agent workbench', () => {
    useUiStore.setState({
      chatCenterCollapsed: false,
      agentPanelCollapsed: true,
      workbenchTab: 'files',
      chatCenterPreviewFile: { projectId: 'P', name: 'a', path: 'a', relativePath: 'a', size: 0, mtime: 0, is_dir: false },
    })
    useUiStore.getState().focusQuickChatWorkbench()
    const s = useUiStore.getState()
    expect(s.chatCenterCollapsed).toBe(true)
    expect(s.agentPanelCollapsed).toBe(false)
    expect(s.workbenchTab).toBe('agent')
    expect(s.chatCenterPreviewFile).toBeNull()
  })

  it('setChatCenterPreviewFile expands center when previewing a file', () => {
    useUiStore.setState({ chatCenterCollapsed: true })
    useUiStore.getState().setChatCenterPreviewFile({
      projectId: 'P',
      name: 'out.csv',
      path: 'out.csv',
      relativePath: 'out.csv',
      size: 1,
      mtime: 1,
      is_dir: false,
    })
    expect(useUiStore.getState().chatCenterCollapsed).toBe(false)
  })
})
