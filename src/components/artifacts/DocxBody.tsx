import { useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'

import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

import { useFileBuffer } from './useFileBuffer'

export function DocxBody({ url, prominent = false }: { url: string; prominent?: boolean }) {
  const lang = useSettingsStore((s) => s.language)
  const containerRef = useRef<HTMLDivElement>(null)
  const state = useFileBuffer(url)

  useEffect(() => {
    if (state.status !== 'ok' || !containerRef.current) return
    const container = containerRef.current
    container.innerHTML = ''
    let cancelled = false
    renderAsync(state.buffer, container, undefined, {
      inWrapper: false,
      breakPages: false,
    }).catch((err: unknown) => {
      if (!cancelled) {
        container.textContent = err instanceof Error ? err.message : String(err)
      }
    })
    return () => {
      cancelled = true
    }
  }, [state])

  if (state.status === 'loading') {
    return <p className="text-xs text-[var(--color-text-muted)]">{t('artifactLoading', lang)}</p>
  }
  if (state.status === 'error') {
    return (
      <p className="text-xs text-[var(--color-error)]">
        {t('artifactLoadFailed', lang)}: {state.message}
      </p>
    )
  }

  return (
    <div
      ref={containerRef}
      className={
        prominent
          ? 'h-full overflow-auto rounded-md bg-white p-4'
          : 'max-h-[480px] overflow-auto rounded-md border border-[var(--color-border)] bg-white p-4'
      }
    />
  )
}
