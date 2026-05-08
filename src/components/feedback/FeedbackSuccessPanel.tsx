import { useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface Props {
  inviteUrl: string | null
  onDone: () => void
}

export function FeedbackSuccessPanel({ inviteUrl, onDone }: Props) {
  const lang = useSettingsStore((s) => s.language)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
      } else {
        const ta = document.createElement('textarea')
        ta.value = inviteUrl
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const handleOpen = () => {
    if (!inviteUrl) return
    window.open(inviteUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm text-[var(--color-text-primary)] leading-relaxed">
              {t('feedbackSuccessReceived', lang)}
            </p>
          </div>
        </div>

        {inviteUrl && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/30 p-4 space-y-3">
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {t('feedbackSuccessJoinGroup', lang)}
            </p>
            <div className="text-xs font-mono text-[var(--color-text-muted)] break-all bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2.5 py-2">
              {inviteUrl}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleOpen}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent)]/80 transition-colors"
              >
                {t('feedbackOpenInviteLink', lang)}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                {copied ? t('feedbackCopiedLabel', lang) : t('feedbackCopyInviteLink', lang)}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
        <button
          onClick={onDone}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent)]/80 transition-colors"
        >
          {t('feedbackDoneAction', lang)}
        </button>
      </div>
    </>
  )
}
