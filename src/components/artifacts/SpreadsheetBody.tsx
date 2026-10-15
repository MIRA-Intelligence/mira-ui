import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

import { CsvTable } from './CsvTable'
import { useFileBuffer } from './useFileBuffer'

type ParsedWorkbook =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; workbook: XLSX.WorkBook }

export function SpreadsheetBody({ url }: { url: string; prominent?: boolean }) {
  const lang = useSettingsStore((s) => s.language)
  const state = useFileBuffer(url)
  const [sheetIndex, setSheetIndex] = useState(0)

  useEffect(() => {
    setSheetIndex(0)
  }, [url])

  const parsed: ParsedWorkbook = useMemo(() => {
    if (state.status !== 'ok') return state
    try {
      return { status: 'ok', workbook: XLSX.read(state.buffer, { type: 'array' }) }
    } catch (err: unknown) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }, [state])

  const sheetName =
    parsed.status === 'ok' ? parsed.workbook.SheetNames[Math.min(sheetIndex, parsed.workbook.SheetNames.length - 1)] : ''

  const csv = useMemo(() => {
    if (parsed.status !== 'ok' || !sheetName) return ''
    return XLSX.utils.sheet_to_csv(parsed.workbook.Sheets[sheetName])
  }, [parsed, sheetName])

  if (parsed.status === 'loading') {
    return <p className="text-xs text-[var(--color-text-muted)]">{t('artifactLoading', lang)}</p>
  }
  if (parsed.status === 'error') {
    return (
      <p className="text-xs text-[var(--color-error)]">
        {t('artifactLoadFailed', lang)}: {parsed.message}
      </p>
    )
  }

  const sheetNames = parsed.workbook.SheetNames

  return (
    <div className="space-y-2">
      {sheetNames.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {sheetNames.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setSheetIndex(i)}
              className={
                i === sheetIndex
                  ? 'px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-bg-hover)] border border-[var(--color-border)] whitespace-nowrap'
                  : 'px-2 py-0.5 rounded text-[10px] bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] border border-transparent whitespace-nowrap transition-colors'
              }
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <CsvTable text={csv} />
    </div>
  )
}
