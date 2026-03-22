import { useProjectStore } from '@/stores/projectStore'
import { formatNumber, cn } from '@/lib/utils'

export function StatusBar() {
  const { stats } = useProjectStore()

  return (
    <footer className="flex items-center justify-between px-6 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* Left: big numbers */}
      <div className="flex items-center gap-6">
        <StatBlock value={stats.hypotheses} label="Hypothesis" />
        <StatBlock value={stats.papers} label="Paper" />
      </div>

      {/* Center: stage pills */}
      <div className="flex items-center gap-2">
        {stats.stages.map((s) => (
          <span
            key={s.label}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full',
              s.active
                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
                : 'text-[var(--color-text-muted)]',
            )}
          >
            {s.label}
          </span>
        ))}
      </div>

      {/* Right: tokens & cost */}
      <div className="flex items-center gap-6">
        <StatBlock value={formatNumber(stats.tokens)} label="Tokens" raw />
        <StatBlock value={`${formatNumber(stats.cost)}`} label="Cost($)" raw />
      </div>
    </footer>
  )
}

function StatBlock({ value, label, raw }: { value: number | string; label: string; raw?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
        {raw ? value : value}
      </span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
    </div>
  )
}
