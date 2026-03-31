import type { ProjectTask } from '@/types'
import { HarnessPanel } from '@/components/harness/HarnessPanel'

export function ReplayView({ task }: { task: ProjectTask }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          Replay
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          Inspect run-level traces, replay diagnostics, and A/B baseline deltas.
        </p>
        <HarnessPanel sessionId={task.id} />
      </div>
    </div>
  )
}

