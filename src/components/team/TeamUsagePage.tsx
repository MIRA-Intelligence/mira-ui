import { useCallback, useEffect, useMemo, useState } from 'react'
import { t, type I18nKey } from '@/i18n'
import { isAdmin } from '@/lib/teamServerProtocol'
import { cn } from '@/lib/utils'
import {
  downloadUsageCsv,
  fetchQuotas,
  fetchUsageReport,
  formatTokens,
  parseTokens,
  saveQuotas,
  type QuotaLimits,
  type QuotaPeriodStatus,
  type QuotaSettings,
  type UsageReport,
} from '@/services/teamUsage'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'
import { useUiStore } from '@/stores/uiStore'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

interface LimitDraft { daily: string; monthly: string }

interface QuotaDraft {
  default: LimitDraft
  warn: string
  users: Record<string, LimitDraft>
}

const inputClass = 'w-full h-8 px-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]'

function limitText(value: number | null): string {
  return value == null ? '' : value === 0 ? '0' : formatTokens(value)
}

function toDraft(settings: QuotaSettings): QuotaDraft {
  const users: Record<string, LimitDraft> = {}
  for (const [name, limits] of Object.entries(settings.users)) {
    users[name] = { daily: limitText(limits.daily), monthly: limitText(limits.monthly) }
  }
  return {
    default: { daily: limitText(settings.default.daily || null), monthly: limitText(settings.default.monthly || null) },
    warn: String(settings.warn_percent),
    users,
  }
}

// The settings to save, or the first invalid field.
function fromDraft(draft: QuotaDraft): QuotaSettings | { invalid: string } {
  const limits = (value: LimitDraft, where: string): QuotaLimits | { invalid: string } => {
    const daily = parseTokens(value.daily)
    const monthly = parseTokens(value.monthly)
    if (daily === undefined) return { invalid: `${where}:daily` }
    if (monthly === undefined) return { invalid: `${where}:monthly` }
    return { daily, monthly }
  }
  const defaults = limits(draft.default, 'default')
  if ('invalid' in defaults) return defaults
  const warn = Number(draft.warn)
  if (!Number.isInteger(warn) || warn < 1 || warn > 100) return { invalid: 'warn' }
  const users: QuotaSettings['users'] = {}
  for (const [name, value] of Object.entries(draft.users)) {
    const parsed = limits(value, name)
    if ('invalid' in parsed) return parsed
    if (parsed.daily !== null || parsed.monthly !== null) users[name] = parsed
  }
  return { default: { daily: defaults.daily || null, monthly: defaults.monthly || null }, users, warn_percent: warn }
}

function shiftMonth(day: string, months: number): { from: string; to: string } {
  const [year, month] = day.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1 + months, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

// Administrators: everyone's team-provider usage, and the token quotas.
export function TeamUsagePage() {
  const open = useUiStore((s) => s.teamUsageOpen)
  const close = useUiStore((s) => s.closeTeamUsage)
  const lang = useSettingsStore((s) => s.language)
  const origin = useTeamServerStore((s) => s.origin)
  const user = useTeamServerStore((s) => s.user)
  const admin = isAdmin(user)
  const isMacDesktop = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'

  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [monthStart, setMonthStart] = useState<string | null>(null)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [models, setModels] = useState<UsageReport | null>(null)
  const [saved, setSaved] = useState<QuotaSettings | null>(null)
  const [draft, setDraft] = useState<QuotaDraft | null>(null)
  const [newUser, setNewUser] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async (period: { from: string; to: string } | null) => {
    if (!origin) return
    setLoading(true)
    try {
      const options = period ?? {}
      const [byUser, byModel] = await Promise.all([
        fetchUsageReport(origin, { ...options, groupBy: ['user'] }),
        fetchUsageReport(origin, { ...options, groupBy: ['provider', 'model'] }),
      ])
      setReport(byUser)
      setModels(byModel)
      if (!period) {
        setRange({ from: byUser.from, to: byUser.to })
        setMonthStart(byUser.from)
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setLoading(false)
    }
  }, [origin])

  useEffect(() => {
    if (!open || !origin || !admin) return
    setFeedback(null)
    void load(null)
    fetchQuotas(origin).then((settings) => {
      setSaved(settings)
      setDraft(toDraft(settings))
    }).catch((error: unknown) => setFeedback({ text: error instanceof Error ? error.message : String(error), error: true }))
  }, [open, origin, admin, load])

  useEffect(() => {
    if (!feedback) return
    const id = setTimeout(() => setFeedback(null), feedback.error ? 6000 : 3000)
    return () => clearTimeout(id)
  }, [feedback])

  const parsed = useMemo(() => (draft ? fromDraft(draft) : null), [draft])
  const invalid = parsed && 'invalid' in parsed ? parsed.invalid : null
  const dirty = Boolean(parsed && saved && !('invalid' in parsed) && JSON.stringify(parsed) !== JSON.stringify(saved))
  const users = useMemo(() => {
    const names = new Set([...(report?.rows ?? []).map((row) => row.user ?? ''), ...Object.keys(draft?.users ?? {})])
    names.delete('')
    return [...names].sort()
  }, [report, draft])

  if (!open || !origin || !admin) return null

  const pick = (period: { from: string; to: string }) => {
    setRange(period)
    void load(period)
  }

  const save = async () => {
    if (!parsed || 'invalid' in parsed) return
    setSaving(true)
    try {
      const settings = await saveQuotas(origin, parsed)
      setSaved(settings)
      setDraft(toDraft(settings))
      setFeedback({ text: t('teamUsageSaved', lang), error: false })
      if (range) void load(range)
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = async () => {
    if (!range) return
    try {
      const blob = await downloadUsageCsv(origin, { ...range, groupBy: ['user', 'provider', 'model'] })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `mira-usage-${range.from}-${range.to}.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    }
  }

  const setUserLimit = (name: string, period: keyof LimitDraft, value: string) =>
    setDraft((current) => current && {
      ...current,
      users: { ...current.users, [name]: { ...(current.users[name] ?? { daily: '', monthly: '' }), [period]: value } },
    })

  const addUser = () => {
    const name = newUser.trim()
    if (!name) return
    setUserLimit(name, 'daily', draft?.users[name]?.daily ?? '')
    setNewUser('')
  }

  const rowsByUser = new Map((report?.rows ?? []).map((row) => [row.user ?? '', row]))
  const thisMonth = monthStart ? shiftMonth(monthStart, 0) : null
  const lastMonth = monthStart ? shiftMonth(monthStart, -1) : null
  // This month starts as the 1st until today, so a range ending earlier in the same month still matches.
  const isRange = (period: { from: string; to: string } | null) =>
    Boolean(period && range && period.from === range.from && range.to <= period.to)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg-primary)]">
      {feedback && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-[120] -translate-x-1/2 px-4">
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className={cn(
              'pointer-events-auto rounded-xl border px-5 py-3 text-sm font-medium shadow-xl',
              feedback.error
                ? 'border-red-500/40 bg-red-500/15 text-red-400'
                : 'border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]',
            )}
          >
            {feedback.text}
          </button>
        </div>
      )}
      {/* Covers the TopBar, an Electron drag region on macOS: opt out so the buttons work. */}
      <div
        data-drag-region="no-drag"
        className={cn('flex items-center justify-between gap-4 py-4 pr-6 border-b border-[var(--color-border)] shrink-0',
          isMacDesktop ? 'pl-24' : 'pl-6')}
      >
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('teamUsageTitle', lang)}</h2>
          <p className="text-[11px] text-[var(--color-text-muted)]">{t('teamUsageSubtitle', lang)}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || Boolean(invalid)}
            className={cn('px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium',
              (!dirty || saving || invalid) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--color-accent)]/80')}
          >
            {saving ? `${t('save', lang)}...` : t('teamUsageSaveQuotas', lang)}
          </button>
          <button type="button" onClick={close} aria-label={t('cancel', lang)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t('teamUsageQuotasTitle', lang)}</h3>
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{t('teamUsageQuotasHint', lang)}</p>
            {draft && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
                <Field label={t('teamUsageDefaultDaily', lang)} invalid={invalid === 'default:daily'}>
                  <input aria-label={t('teamUsageDefaultDaily', lang)} className={inputClass}
                    value={draft.default.daily} placeholder={t('teamUsageUnlimited', lang)}
                    onChange={(e) => setDraft({ ...draft, default: { ...draft.default, daily: e.target.value } })} />
                </Field>
                <Field label={t('teamUsageDefaultMonthly', lang)} invalid={invalid === 'default:monthly'}>
                  <input aria-label={t('teamUsageDefaultMonthly', lang)} className={inputClass}
                    value={draft.default.monthly} placeholder={t('teamUsageUnlimited', lang)}
                    onChange={(e) => setDraft({ ...draft, default: { ...draft.default, monthly: e.target.value } })} />
                </Field>
                <Field label={t('teamUsageWarnPercent', lang)} invalid={invalid === 'warn'}>
                  <input aria-label={t('teamUsageWarnPercent', lang)} className={inputClass} inputMode="numeric"
                    value={draft.warn} onChange={(e) => setDraft({ ...draft, warn: e.target.value })} />
                </Field>
              </div>
            )}
            {invalid && <p role="alert" className="text-[11px] text-red-400">{t('teamUsageInvalid', lang)}</p>}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t('teamUsageUsersTitle', lang)}</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {thisMonth && <RangeButton active={isRange(thisMonth)} onClick={() => pick(thisMonth)}>{t('teamUsageThisMonth', lang)}</RangeButton>}
                {lastMonth && <RangeButton active={isRange(lastMonth)} onClick={() => pick(lastMonth)}>{t('teamUsageLastMonth', lang)}</RangeButton>}
                {range && (
                  <>
                    <input type="date" aria-label={t('teamUsageFrom', lang)} value={range.from} max={range.to}
                      onChange={(e) => e.target.value && pick({ ...range, from: e.target.value })}
                      className={cn(inputClass, 'w-36')} />
                    <span className="text-[var(--color-text-muted)]">–</span>
                    <input type="date" aria-label={t('teamUsageTo', lang)} value={range.to} min={range.from}
                      onChange={(e) => e.target.value && pick({ ...range, to: e.target.value })}
                      className={cn(inputClass, 'w-36')} />
                  </>
                )}
                <button type="button" onClick={() => void exportCsv()} disabled={!range}
                  className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                  {t('teamUsageExportCsv', lang)}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    <Th>{t('teamUsageUser', lang)}</Th>
                    <Th right>{t('teamUsageInput', lang)}</Th>
                    <Th right>{t('teamUsageOutput', lang)}</Th>
                    <Th right>{t('teamUsageTotal', lang)}</Th>
                    <Th right>{t('teamUsageCalls', lang)}</Th>
                    <Th>{t('teamUsageToday', lang)}</Th>
                    <Th>{t('teamUsageMonth', lang)}</Th>
                    <Th>{t('teamUsageOverride', lang)}</Th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--color-text-muted)]">
                      {loading ? t('teamUsageLoading', lang) : t('teamUsageEmpty', lang)}
                    </td></tr>
                  )}
                  {users.map((name) => {
                    const row = rowsByUser.get(name)
                    const override = draft?.users[name] ?? { daily: '', monthly: '' }
                    return (
                      <tr key={name} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2 font-mono">{name}</td>
                        <Num value={row?.input_tokens} />
                        <Num value={row?.output_tokens} />
                        <Num value={row?.total_tokens} strong />
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row ? row.calls.toLocaleString('en-US') : '–'}
                          {row && row.unreported_calls > 0 && (
                            <span title={t('teamUsageUnreportedHint', lang)} className="ml-1 text-[var(--color-text-muted)]">
                              ({row.unreported_calls}?)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2"><QuotaCell status={row?.quota?.daily} lang={lang} /></td>
                        <td className="px-3 py-2"><QuotaCell status={row?.quota?.monthly} lang={lang} /></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5 w-56">
                            <input aria-label={t('teamUsageOverrideDailyFor', lang, { user: name })}
                              className={cn(inputClass, invalid === `${name}:daily` && 'border-red-500/60')}
                              value={override.daily} placeholder={t('teamUsageDailyDefault', lang)}
                              onChange={(e) => setUserLimit(name, 'daily', e.target.value)} />
                            <input aria-label={t('teamUsageOverrideMonthlyFor', lang, { user: name })}
                              className={cn(inputClass, invalid === `${name}:monthly` && 'border-red-500/60')}
                              value={override.monthly} placeholder={t('teamUsageMonthlyDefault', lang)}
                              onChange={(e) => setUserLimit(name, 'monthly', e.target.value)} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {report && report.rows.length > 0 && (
                  <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] font-medium">
                    <tr>
                      <td className="px-3 py-2">{t('teamUsageAllUsers', lang)}</td>
                      <Num value={report.totals.input_tokens} />
                      <Num value={report.totals.output_tokens} />
                      <Num value={report.totals.total_tokens} strong />
                      <td className="px-3 py-2 text-right tabular-nums">{report.totals.calls.toLocaleString('en-US')}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <input aria-label={t('teamUsageAddUser', lang)} className={cn(inputClass, 'w-48')} value={newUser}
                placeholder={t('teamUsageAddUserPlaceholder', lang)} onChange={(e) => setNewUser(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addUser() }} />
              <button type="button" onClick={addUser} disabled={!newUser.trim()}
                className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50">
                {t('teamUsageAddUser', lang)}
              </button>
            </div>
          </section>

          {models && models.rows.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t('teamUsageModelsTitle', lang)}</h3>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                    <tr>
                      <Th>{t('teamUsageProvider', lang)}</Th>
                      <Th>{t('teamUsageModel', lang)}</Th>
                      <Th right>{t('teamUsageInput', lang)}</Th>
                      <Th right>{t('teamUsageOutput', lang)}</Th>
                      <Th right>{t('teamUsageTotal', lang)}</Th>
                      <Th right>{t('teamUsageCalls', lang)}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.rows.map((row) => (
                      <tr key={`${row.provider}/${row.model}`} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">{row.provider}</td>
                        <td className="px-3 py-2 font-mono">{row.model || '–'}</td>
                        <Num value={row.input_tokens} />
                        <Num value={row.output_tokens} />
                        <Num value={row.total_tokens} strong />
                        <td className="px-3 py-2 text-right tabular-nums">{row.calls.toLocaleString('en-US')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, invalid, children }: { label: string; invalid: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('block space-y-1 text-[11px] text-[var(--color-text-secondary)]',
      invalid && '[&_input]:border-red-500/60')}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('px-3 py-2 font-medium whitespace-nowrap', right ? 'text-right' : 'text-left')}>{children}</th>
}

function Num({ value, strong }: { value: number | undefined; strong?: boolean }) {
  return (
    <td className={cn('px-3 py-2 text-right tabular-nums', strong && 'font-medium')}
      title={value != null ? value.toLocaleString('en-US') : undefined}>
      {value != null ? formatTokens(value) : '–'}
    </td>
  )
}

function RangeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('h-8 px-3 rounded-md border text-xs',
        active ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]')}>
      {children}
    </button>
  )
}

export function QuotaCell({ status, lang }: { status: QuotaPeriodStatus | undefined; lang: Lang }) {
  if (!status) return <span className="text-[var(--color-text-muted)]">–</span>
  const limited = status.limit != null
  const ratio = limited ? Math.min(status.used / Math.max(status.limit as number, 1), 1) : 0
  const tone: I18nKey | null = status.exceeded ? 'teamUsageExceeded' : null
  return (
    <div className="min-w-[110px] space-y-1">
      <div className={cn('tabular-nums whitespace-nowrap', status.exceeded ? 'text-red-400 font-medium'
        : status.warn ? 'text-[var(--color-notice-text)] font-medium' : '')}>
        {formatTokens(status.used)} / {limited ? formatTokens(status.limit as number) : t('teamUsageUnlimited', lang)}
        {tone && ` · ${t(tone, lang)}`}
      </div>
      {limited && (
        <div className="h-1 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
          <div className={cn('h-full rounded-full', status.exceeded ? 'bg-red-500'
            : status.warn ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-accent)]')}
            style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
