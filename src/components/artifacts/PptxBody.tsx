import { useEffect, useRef, useState } from 'react'
import { init } from 'pptx-preview'

import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

import { fixSlideTextContrast } from './fixSlideTextContrast'
import { patchPptxTemplateShapes } from './patchPptxTemplateShapes'
import { patchPptxTextAlignment } from './patchPptxTextAlignment'
import { patchPptxTextRuns } from './patchPptxTextRuns'
import { useFileBuffer } from './useFileBuffer'

export function PptxBody({ url, prominent = false }: { url: string; prominent?: boolean }) {
  const lang = useSettingsStore((s) => s.language)
  const containerRef = useRef<HTMLDivElement>(null)
  const state = useFileBuffer(url)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    setRenderError(null)
  }, [url])

  useEffect(() => {
    if (state.status !== 'ok' || !containerRef.current) return
    const previewer = init(containerRef.current, { mode: 'list', width: 640 })
    let cancelled = false
    void (async () => {
      const shaped = await patchPptxTemplateShapes(state.buffer)
      const aligned = await patchPptxTextAlignment(shaped)
      const buffer = await patchPptxTextRuns(aligned)
      if (cancelled) return
      await previewer.preview(buffer)
      if (cancelled || !containerRef.current) return
      await fixSlideTextContrast(containerRef.current)
    })().catch((err: unknown) => {
      if (!cancelled) {
        setRenderError(err instanceof Error ? err.message : String(err))
      }
    })
    return () => {
      cancelled = true
      previewer.destroy()
    }
  }, [state])

  if (state.status === 'loading') {
    return <p className="text-xs text-[var(--color-text-muted)]">{t('artifactLoading', lang)}</p>
  }
  if (state.status === 'error' || renderError) {
    const message = state.status === 'error' ? state.message : renderError
    return (
      <p className="text-xs text-[var(--color-error)]">
        {t('artifactLoadFailed', lang)}: {message}
      </p>
    )
  }

  return (
    <div
      ref={containerRef}
      className={
        prominent
          ? 'h-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-2'
          : 'max-h-[520px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-2'
      }
    />
  )
}
