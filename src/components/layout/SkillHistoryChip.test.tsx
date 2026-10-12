import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillHistoryChip } from './SkillHistoryChip'
import { useSkillHistoryStore } from '@/stores/skillHistoryStore'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { SkillLoadEvent } from '@/types'

const event = (id: string): SkillLoadEvent => ({ id, skill_name: `demo-${id}`, source: 'manual', loaded_at: `2026-10-12T10:00:0${id}Z`, partial: false })
const ingest = (id: string) => useSkillHistoryStore.getState().ingest('a', event(id))

describe('SkillHistoryChip', () => {
  beforeEach(() => {
    useSkillHistoryStore.getState().reset()
    useAgentStore.setState({ connected: false })
    useSettingsStore.setState({ language: 'en' })
  })
  afterEach(() => vi.useRealTimers())

  it('displays sequential live loads then settles on latest', () => {
    vi.useFakeTimers()
    render(<SkillHistoryChip sessionId="a" />)
    act(() => { ingest('1'); ingest('2'); ingest('3') })
    const chip = screen.getByRole('button', { name: 'Skill load history' })
    expect(chip).toHaveTextContent('$demo-1')
    act(() => vi.advanceTimersByTime(2500))
    expect(chip).toHaveTextContent('$demo-2')
    act(() => vi.advanceTimersByTime(2500))
    expect(chip).toHaveTextContent('$demo-3')
    act(() => vi.advanceTimersByTime(2500))
    expect(chip).toHaveTextContent('$demo-3')
  })

  it('opens timestamped history newest first, supports Escape and outside dismissal', () => {
    ingest('1'); ingest('2')
    render(<SkillHistoryChip sessionId="a" />)
    const chip = screen.getByRole('button', { name: 'Skill load history' })
    expect(chip).toHaveTextContent('$demo-2')
    fireEvent.click(chip)
    const dialog = screen.getByRole('dialog')
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('$demo-2')
    expect(rows[1].querySelector('time')).toHaveAttribute('datetime', event('1').loaded_at)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
    fireEvent.click(chip); fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('isolates session histories and shows an empty state', () => {
    ingest('1')
    render(<SkillHistoryChip sessionId="b" />)
    fireEvent.click(screen.getByRole('button', { name: 'Skill load history' }))
    expect(screen.queryByText('$demo-1')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('No skills loaded')
  })
})
