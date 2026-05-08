import { useFeedbackStore } from '@/stores/feedbackStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export function FeedbackButton({ className }: { className?: string }) {
  const openDialog = useFeedbackStore((s) => s.openDialog)
  const pendingCount = useFeedbackStore((s) => s.pendingCount)
  const lang = useSettingsStore((s) => s.language)

  const tooltip = pendingCount > 0
    ? `${t('feedback', lang)} · ${t('feedbackPendingNotice', lang, { count: pendingCount })}`
    : t('feedback', lang)

  return (
    <button
      type="button"
      onClick={openDialog}
      aria-label={t('feedbackButtonAria', lang)}
      title={tooltip}
      className={cn(
        'relative w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors',
        className,
      )}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {pendingCount > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-amber-500 text-[10px] font-medium text-white flex items-center justify-center leading-none"
        >
          {pendingCount > 9 ? '9+' : pendingCount}
        </span>
      )}
    </button>
  )
}
