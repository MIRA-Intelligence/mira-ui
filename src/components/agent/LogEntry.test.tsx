import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LogEntry } from './LogEntry'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import type { LogEntry as LogEntryType } from '@/types'

const initialSettingsState = useSettingsStore.getState()

function makeErrorEntry(metadata: Record<string, unknown>): LogEntryType {
  return {
    id: 'err-1',
    timestamp: new Date().toISOString(),
    content: 'Sorry, I ran into a problem while handling your message. RuntimeError: boom',
    type: 'error',
    metadata,
  }
}

describe('LogEntry error localization', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialSettingsState, true)
  })

  it('localizes a known error code in English', () => {
    useSettingsStore.setState({ language: 'en' })
    render(<LogEntry entry={makeErrorEntry({ _error: true, error_code: 'auth' })} />)
    expect(screen.getByText(t('errorAuth', 'en'))).toBeInTheDocument()
  })

  it('localizes a known error code in Chinese', () => {
    useSettingsStore.setState({ language: 'zh' })
    render(<LogEntry entry={makeErrorEntry({ _error: true, error_code: 'timeout' })} />)
    expect(screen.getByText(t('errorTimeout', 'zh'))).toBeInTheDocument()
  })

  it('interpolates detail for the unknown code', () => {
    useSettingsStore.setState({ language: 'en' })
    render(
      <LogEntry
        entry={makeErrorEntry({ _error: true, error_code: 'unknown', error_detail: 'KeyError: widget' })}
      />,
    )
    expect(screen.getByText(t('errorUnknown', 'en', { detail: 'KeyError: widget' }))).toBeInTheDocument()
  })

  it('falls back to server content when error_code is absent', () => {
    useSettingsStore.setState({ language: 'en' })
    const entry = makeErrorEntry({ _error: true })
    render(<LogEntry entry={entry} />)
    expect(screen.getByText(entry.content)).toBeInTheDocument()
  })
})
