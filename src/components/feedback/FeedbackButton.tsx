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
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <polygon
          points="12,7.5 12.82,9.87 15.33,9.92 13.33,11.43 14.06,13.83 12,12.4 9.94,13.83 10.67,11.43 8.67,9.92 11.18,9.87"
          fill="currentColor"
          stroke="none"
        />
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
