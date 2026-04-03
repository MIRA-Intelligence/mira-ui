import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

export function StatusBar() {
  const { stats } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)

  return (
    <footer className="flex items-center justify-between px-6 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <div className="flex items-center gap-6">
        <StatBlock value={stats.experiments} label={t('experiments', lang)} />
        <StatBlock value={stats.completed} label={t('completed', lang)} />
      </div>

      <div className="flex items-center gap-6">
        <StatBlock value={stats.running} label={t('running', lang)} />
        <StatBlock value={stats.failed} label={t('failed', lang)} />
      </div>
    </footer>
  )
}

function StatBlock({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
        {value}
      </span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
    </div>
  )
}
