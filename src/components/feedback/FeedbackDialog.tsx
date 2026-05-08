import { useEffect, useMemo, useState } from 'react'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getDisplayHandle } from '@/lib/clientId'
import { getInviteUrl } from '@/services/feedback'
import { t, type I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { FeedbackSuccessPanel } from './FeedbackSuccessPanel'
import type {
  FeedbackContactKind,
  FeedbackSeverity,
  FeedbackType,
} from '@/services/feedback/types'

const TYPE_OPTIONS: Array<{ value: FeedbackType; labelKey: I18nKey }> = [
  { value: 'bug', labelKey: 'feedbackTypeBug' },
  { value: 'feature', labelKey: 'feedbackTypeFeature' },
  { value: 'question', labelKey: 'feedbackTypeQuestion' },
  { value: 'other', labelKey: 'feedbackTypeOther' },
]

const SEVERITY_OPTIONS: Array<{ value: FeedbackSeverity; labelKey: I18nKey; tone: string }> = [
  { value: 'blocker', labelKey: 'feedbackSeverityBlocker', tone: 'border-red-400 text-red-300' },
  { value: 'critical', labelKey: 'feedbackSeverityCritical', tone: 'border-amber-400 text-amber-300' },
  { value: 'normal', labelKey: 'feedbackSeverityNormal', tone: 'border-sky-400 text-sky-300' },
  { value: 'minor', labelKey: 'feedbackSeverityMinor', tone: 'border-slate-500 text-slate-300' },
]

const CONTACT_OPTIONS: Array<{ value: FeedbackContactKind; labelKey: I18nKey }> = [
  { value: 'wechat', labelKey: 'feedbackContactWechat' },
  { value: 'phone', labelKey: 'feedbackContactPhone' },
  { value: 'email', labelKey: 'feedbackContactEmail' },
]

const inputClass =
  'w-full bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'

export function FeedbackDialog() {
  const dialogOpen = useFeedbackStore((s) => s.dialogOpen)
  const closeDialog = useFeedbackStore((s) => s.closeDialog)
  const submissionState = useFeedbackStore((s) => s.submissionState)
  const errorMessage = useFeedbackStore((s) => s.errorMessage)
  const success = useFeedbackStore((s) => s.success)
  const submit = useFeedbackStore((s) => s.submit)
  const resetForm = useFeedbackStore((s) => s.resetForm)
  const lang = useSettingsStore((s) => s.language)

  const [type, setType] = useState<FeedbackType>('bug')
  const [severity, setSeverity] = useState<FeedbackSeverity>('normal')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [contactKind, setContactKind] = useState<FeedbackContactKind>('wechat')
  const [contactValue, setContactValue] = useState('')

  const handle = useMemo(() => getDisplayHandle(), [])
  const promoUrl = useMemo(() => getInviteUrl(), [])

  useEffect(() => {
    if (!dialogOpen) {
      setType('bug')
      setSeverity('normal')
      setTitle('')
      setBody('')
      setContactKind('wechat')
      setContactValue('')
    }
  }, [dialogOpen])

  if (!dialogOpen) return null

  const showSuccess = submissionState === 'success' && success !== null
  const sending = submissionState === 'sending'
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !sending

  const handleSubmit = async () => {
    await submit({
      type,
      severity: type === 'bug' ? severity : null,
      title,
      body,
      contact: contactValue.trim().length > 0
        ? { kind: contactKind, value: contactValue.trim() }
        : null,
      route: typeof window !== 'undefined' ? window.location.pathname || '/' : '/',
      locale: lang,
    })
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeDialog()
  }

  const errorText = (() => {
    if (!errorMessage) return null
    if (errorMessage === 'throttled') return t('feedbackThrottled', lang)
    if (errorMessage === 'invalid') return t('feedbackInvalid', lang)
    if (errorMessage === 'not_configured') return t('feedbackNotConfigured', lang)
    return t('feedbackSubmitFailed', lang, { error: errorMessage })
  })()

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--color-overlay)]"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[560px] max-h-[85vh] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {showSuccess ? t('feedbackSuccessTitle', lang) : t('feedbackTitle', lang)}
          </h2>
          <button
            onClick={closeDialog}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label={t('cancel', lang)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {showSuccess ? (
          <FeedbackSuccessPanel
            onDone={() => {
              resetForm()
              closeDialog()
            }}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-[12px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-md px-3 py-2 leading-relaxed">
                {t('feedbackPrivacyNotice', lang)}
              </p>

              <Field label={t('feedbackTypeLabel', lang)}>
                <div className="flex gap-2 flex-wrap">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setType(opt.value)}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                        type === opt.value
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      {t(opt.labelKey, lang)}
                    </button>
                  ))}
                </div>
              </Field>

              {type === 'bug' && (
                <Field label={t('feedbackSeverityLabel', lang)}>
                  <div className="flex gap-2 flex-wrap">
                    {SEVERITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSeverity(opt.value)}
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                          severity === opt.value
                            ? `${opt.tone} bg-[var(--color-bg-tertiary)]`
                            : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
                        )}
                      >
                        {t(opt.labelKey, lang)}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={t('feedbackSubject', lang)} required>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                  placeholder={t('feedbackSubjectPlaceholder', lang)}
                  className={inputClass}
                  maxLength={120}
                />
              </Field>

              <Field label={t('feedbackBody', lang)} required>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, 4000))}
                  placeholder={t('feedbackBodyPlaceholder', lang)}
                  rows={6}
                  className={`${inputClass} resize-none leading-relaxed`}
                  maxLength={4000}
                />
              </Field>

              <Field label={t('feedbackContactLabel', lang)}>
                <div className="flex gap-2">
                  <select
                    value={contactKind}
                    onChange={(e) => setContactKind(e.target.value as FeedbackContactKind)}
                    className={`${inputClass} max-w-[120px] py-2`}
                  >
                    {CONTACT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey, lang)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={contactValue}
                    onChange={(e) => setContactValue(e.target.value.slice(0, 120))}
                    placeholder={t('feedbackContactPlaceholder', lang)}
                    className={inputClass}
                    maxLength={120}
                  />
                </div>
              </Field>

              <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] pt-1">
                <span>
                  {t('feedbackHandleLabel', lang)}: <span className="font-mono">{handle}</span>
                </span>
              </div>

              <div className="rounded-md border border-dashed border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-3 py-2.5 flex items-start gap-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 mt-0.5 text-[var(--color-accent)]"
                  aria-hidden
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)] flex-1">
                  {t('feedbackPromoText', lang)}{' '}
                  <a
                    href={promoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(promoUrl, '_blank', 'noopener,noreferrer')
                    }}
                    className="text-[var(--color-accent)] underline underline-offset-2 hover:opacity-80 break-all"
                  >
                    {t('feedbackPromoCta', lang)}
                  </a>
                </p>
              </div>

              {errorText && (
                <p className={cn(
                  'text-xs px-3 py-2 rounded-md border',
                  submissionState === 'queued'
                    ? 'text-sky-200 border-sky-500/30 bg-sky-950/30'
                    : 'text-red-300 border-red-500/30 bg-red-950/30',
                )}>
                  {submissionState === 'queued' ? t('feedbackQueuedRetry', lang) : errorText}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={closeDialog}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                {t('cancel', lang)}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  'px-4 py-2 text-sm rounded-lg font-medium transition-colors',
                  canSubmit
                    ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/80'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] cursor-not-allowed',
                )}
              >
                {sending ? t('feedbackSubmitting', lang) : t('feedbackSubmit', lang)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
