import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SshPromptDialog } from './SshPromptDialog'
import { useSettingsStore } from '@/stores/settingsStore'

const initialSettings = useSettingsStore.getState()

describe('SshPromptDialog', () => {
  let emitPrompt: (value: unknown) => void
  let emitCancel: (value: unknown) => void
  let answer: ReturnType<typeof vi.fn<(id: string, value: string | null) => Promise<boolean>>>

  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettings, language: 'en' }, true)
    emitPrompt = () => {}
    emitCancel = () => {}
    answer = vi.fn(async (_id: string, _value: string | null) => true)
    window.electronAPI = {
      platform: 'darwin',
      onRemoteSshPrompt: vi.fn((listener) => { emitPrompt = listener; return () => {} }),
      onRemoteSshPromptCancel: vi.fn((listener) => { emitCancel = listener; return () => {} }),
      answerRemoteSshPrompt: answer,
    }
  })
  afterEach(() => { delete window.electronAPI })

  const prompt = (overrides: Record<string, unknown> = {}) => act(() => {
    emitPrompt({ id: 'p1', host: 'ana@lab', kind: 'secret', text: "ana@lab's password: ", retry: false, ...overrides })
  })

  it('renders nothing until ssh asks something', () => {
    render(<SshPromptDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for a password with a masked field and sends it on Enter', () => {
    render(<SshPromptDialog />)
    prompt()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('SSH: ana@lab')).toBeTruthy()
    expect(screen.getByText("ana@lab's password:")).toBeTruthy()
    const input = screen.getByLabelText('Answer') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByText('Show'))
    expect(input.type).toBe('text')
    fireEvent.click(screen.getByText('Hide'))
    expect(input.type).toBe('password')

    fireEvent.change(input, { target: { value: 'hunter2' } })
    fireEvent.submit(input.closest('form')!)
    expect(answer).toHaveBeenCalledWith('p1', 'hunter2')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders above the Settings modal, outside its stacking context', () => {
    // Connecting starts from Settings (z-[100]); the prompt was hidden behind it.
    render(
      <div className="fixed inset-0 z-[100]" data-testid="settings" style={{ transform: 'translateZ(0)' }}>
        <SshPromptDialog />
      </div>,
    )
    prompt()
    const dialog = screen.getByRole('dialog')
    expect(dialog.parentElement).toBe(document.body)
    expect(screen.getByTestId('settings').contains(dialog)).toBe(false)
    const zIndex = Number(/z-\[(\d+)\]/.exec(dialog.className)?.[1])
    expect(zIndex).toBeGreaterThan(1000)
  })

  it('cancels on Escape and on the Cancel button', () => {
    render(<SshPromptDialog />)
    prompt()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(answer).toHaveBeenLastCalledWith('p1', null)
    prompt({ id: 'p2' })
    fireEvent.click(screen.getByText('Cancel'))
    expect(answer).toHaveBeenLastCalledWith('p2', null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms an unknown host key with the fingerprint shown', () => {
    render(<SshPromptDialog />)
    prompt({ kind: 'host_key', text: "The authenticity of host 'lab' can't be established.\nED25519 key fingerprint is SHA256:abcdef.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? " })
    expect(screen.getByText(/SHA256:abcdef/)).toBeTruthy()
    expect(screen.getByText(/Check the fingerprint/)).toBeTruthy()
    expect(screen.queryByLabelText('Answer')).toBeNull()
    fireEvent.click(screen.getByText('Trust and connect'))
    expect(answer).toHaveBeenCalledWith('p1', 'yes')
  })

  it('shows prompts one after another, flags retries, and closes cancelled ones', () => {
    render(<SshPromptDialog />)
    prompt()
    prompt({ id: 'p2', text: 'Verification code: ', retry: true })
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('OK'))
    expect(answer).toHaveBeenCalledWith('p1', 'pw')
    // The next prompt starts empty and says the previous attempt failed.
    expect(screen.getByText('Verification code:')).toBeTruthy()
    expect((screen.getByLabelText('Answer') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('alert').textContent).toContain('try again')
    act(() => emitCancel({ id: 'p2' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
