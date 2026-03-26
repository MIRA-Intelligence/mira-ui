import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTimer } from '@/hooks/useTimer'

export function TopBar() {
  const { tasks, selectedTaskId, startedAt } = useProjectStore()
  const { openSettings } = useSettingsStore()
  const { formatted } = useTimer(startedAt)

  const selected = tasks.find((t) => t.id === selectedTaskId)
  const title = selected?.title ?? 'MedPilot'

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* Left: settings gear */}
      <div className="w-32 flex items-center">
        <button
          onClick={openSettings}
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <h1 className="text-lg font-semibold text-[var(--color-text-primary)] text-center flex-1 truncate">
        {title}
      </h1>

      <div className="font-mono text-xl tracking-wider text-[var(--color-text-secondary)] tabular-nums min-w-[140px] text-right">
        T+ {formatted}
      </div>
    </header>
  )
}
