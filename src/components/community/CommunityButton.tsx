import { useEffect } from 'react'

import { useCommunityStore } from '@/stores/communityStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const REFRESH_MS = 60_000

export function CommunityButton({ className }: { className?: string }) {
  const openCommunity = useUiStore((s) => s.openCommunity)
  const lang = useSettingsStore((s) => s.language)
  const pendingCount = useCommunityStore((s) => s.status?.pending_count ?? 0)
  const unreadCount = useCommunityStore((s) => s.status?.unread?.total ?? 0)
  const refresh = useCommunityStore((s) => s.refresh)
  const badge = pendingCount + unreadCount

  // Status fetch on mount and then every minute, so new mail and approvals show
  // up on the badge without opening the panel. Safe no-op when the engine
  // isn't reachable.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <button
      type="button"
      onClick={openCommunity}
      aria-label={t('communityTitle', lang)}
      title={t('communityTitle', lang)}
      data-drag-region="no-drag"
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
        <circle cx="9" cy="7" r="3" />
        <path d="M2 21v-1a6 6 0 0 1 6-6h2" />
        <circle cx="17" cy="11" r="3" />
        <path d="M22 21v-1a5 5 0 0 0-7-4.58" />
      </svg>
      {badge > 0 && (
        <span
          aria-hidden
          className={cn(
            'absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[10px] font-medium text-white flex items-center justify-center leading-none',
            // Amber when something waits for a decision, otherwise the accent colour.
            pendingCount > 0 ? 'bg-amber-500' : 'bg-[var(--color-accent)]',
          )}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}
