import { useProjectStore } from '@/stores/projectStore'

export function StatusBar() {
  const { stats } = useProjectStore()

  return (
    <footer className="flex items-center justify-between px-6 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <div className="flex items-center gap-6">
        <StatBlock value={stats.experiments} label="Experiments" />
        <StatBlock value={stats.completed} label="Completed" />
      </div>

      <div className="flex items-center gap-6">
        <StatBlock value={stats.running} label="Running" />
        <StatBlock value={stats.failed} label="Failed" />
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
