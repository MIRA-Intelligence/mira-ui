import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface CommunityChatItemProps {
  isSelected: boolean
  /** Agent messages the user has not looked at yet. */
  unread: number
  disabled?: boolean
  onSelect: () => void
}

/**
 * The pinned row of the reserved Mira Community chat, where the agent reports
 * what it did in the community. It belongs to the agent: no rename, delete,
 * move or drag, and it never joins a batch.
 */
export function CommunityChatItem({ isSelected, unread, disabled = false, onSelect }: CommunityChatItemProps) {
  const lang = useSettingsStore((s) => s.language)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={t('communityChatHint', lang)}
      data-testid="community-chat"
      className={cn(
        'w-full px-3 py-2 text-left rounded-md text-sm transition-colors select-none flex items-center gap-2',
        isSelected
          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-accent)]/40'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
      )}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-accent)]">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <span className="truncate flex-1">{t('communityTitle', lang)}</span>
      {unread > 0 && (
        <span
          title={t('communityChatUnread', lang, { count: String(unread) })}
          className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-white text-[10px] font-medium flex items-center justify-center"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}
