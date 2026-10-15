import { useEffect, useId, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchJournalProfiles, type JournalProfile } from '@/services/journals'

export function JournalTargetSelect({ value, onChange, disabled = false }: {
  value: JournalProfile | null
  onChange: (profile: JournalProfile | null) => void
  disabled?: boolean
}) {
  const lang = useSettingsStore((s) => s.language)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const zh = lang === 'zh'
  const id = useId()
  const [profiles, setProfiles] = useState<JournalProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    setProfiles([])
    onChange(null)
    void fetchJournalProfiles(controller.signal).then((items) => {
      if (!controller.signal.aborted) setProfiles(items)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [apiUrl, retry, onChange])

  return <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-border)] p-3">
    <label htmlFor={id} className="block text-xs font-medium">{zh ? '目标期刊' : 'Target journal'}</label>
    <select id={id} value={value?.id ?? ''} disabled={disabled || loading}
      onChange={(event) => onChange(profiles.find((profile) => profile.id === event.target.value) ?? null)}
      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-sm">
      <option value="">{zh ? '通用格式 / 尚未确定期刊' : 'Generic / journal not decided'}</option>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select>
    <p className="text-xs text-[var(--color-text-muted)]">{zh ? '预设针对原创研究论文。综述、技术短文等其他类型请在目标中说明，由 AI 进一步确认。' : 'Presets cover original research. Specify reviews, technical notes or other article types in your goal for clarification.'}</p>
    {loading && <p role="status" className="text-xs">{zh ? '正在获取期刊规范…' : 'Loading journal profiles…'}</p>}
    {error && <p role="alert" className="text-xs text-amber-500">
      {zh ? '期刊列表不可用，请重试或更新 engine；仍可使用通用格式。' : 'Journal catalog unavailable. Retry or update the engine; generic format is still available.'}
      {' '}<button type="button" disabled={disabled} onClick={() => setRetry((n) => n + 1)} className="underline">{zh ? '重试' : 'Retry'}</button>
    </p>}
    {value && <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
      <p>{value.focus} · {value.article_type}</p>
      <p>{zh ? '来源检查日期' : 'Source check'}: {value.checked_at} · <a href={value.guidelines_url} target="_blank" rel="noopener noreferrer" className="underline">{zh ? '官方作者指南' : 'Official author guide'}</a></p>
      {value.verification_status === 'needs_verification' && <p role="alert" className="text-amber-500">{zh ? '此期刊官方指南尚未完整核验：先生成科学内容草稿，投稿格式需补充官方指南后确认。' : 'Official requirements are not fully verified. Draft scientific content first; supply the guide before final submission formatting.'}</p>}
      <p>{zh ? '规范可能更新，投稿前请复核。Word 草稿不等同于完整投稿文件包。' : 'Requirements may change; recheck before submission. An editable Word draft is not a complete submission package.'}</p>
    </div>}
  </div>
}
