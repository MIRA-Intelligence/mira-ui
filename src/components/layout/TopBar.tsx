import { useProjectStore } from '@/stores/projectStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTimer } from '@/hooks/useTimer'
import { t } from '@/i18n'
import { FeedbackButton } from '@/components/feedback/FeedbackButton'
import { CommunityButton } from '@/components/community/CommunityButton'
import type { CSSProperties } from 'react'

export function TopBar() {
  const { appMode, tasks, selectedTaskId } = useProjectStore()
  const activeChatId = useChatStore((s) => s.activeChatId)
  const chats = useChatStore((s) => s.chats)
  const lang = useSettingsStore((s) => s.language)
  const engineStartedAt = useSettingsStore((s) => s.engineStartedAt)
  const { formatted } = useTimer(engineStartedAt)
  const isMacDesktop = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const dragStyle = isMacDesktop ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined

  const selected = tasks.find((t) => t.id === selectedTaskId)
  const activeChat = chats.find((c) => c.id === activeChatId)
  const title = appMode === 'normal'
    ? (activeChat?.title || t('normalChatTitle', lang))
    : selected?.title ?? 'Mira'

  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]"
      data-drag-region={isMacDesktop ? 'drag' : 'none'}
      style={dragStyle}
    >
      <div className={isMacDesktop ? 'min-w-[220px]' : 'min-w-[140px]'} />

      <h1 className="text-lg font-semibold text-[var(--color-text-primary)] text-center flex-1 truncate">
        {title}
      </h1>

      <div className="flex items-center gap-3 min-w-[140px] justify-end">
        <CommunityButton />
        <FeedbackButton />
        <div
          className="font-mono text-xl tracking-wider text-[var(--color-text-secondary)] tabular-nums"
          title={t('engineUptimeTooltip', lang)}
        >
          T+ {formatted}
        </div>
      </div>
    </header>
  )
}
