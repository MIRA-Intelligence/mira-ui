import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

export function StatusBar() {
  const { stats } = useProjectStore()
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const engineStatus = useSettingsStore((s) => s.engineStatus)
  const engineMessage = useSettingsStore((s) => s.engineMessage)
  const localEnginePhase = useSettingsStore((s) => s.localEnginePhase)
  const showEngineWarning = deploymentMode === 'localBundle' && (engineStatus === 'incompatible' || engineStatus === 'unreachable' || engineStatus === 'setup_required' || localEnginePhase === 'error')

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {showEngineWarning && (
        <div className="px-6 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-500/30">
          {engineMessage || 'Local engine needs attention. Open settings to finish provider setup or update your engine.'}
        </div>
      )}
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-6">
          <StatBlock value={stats.experiments} label={t('experiments', lang)} />
          <StatBlock value={stats.completed} label={t('completed', lang)} />
        </div>

        <div className="flex items-center gap-6">
          <StatBlock value={stats.running} label={t('running', lang)} />
          <StatBlock value={stats.failed} label={t('failed', lang)} />
        </div>
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
