import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

const ACTIVE_UPDATE_PHASES = new Set([
  'checking',
  'installing',
  'updating',
  'repairing',
  'starting',
  'error',
])

export function LocalEngineUpdateModal() {
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const operation = useSettingsStore((s) => s.localEngineOperation)
  const phase = useSettingsStore((s) => s.localEnginePhase)
  const message = useSettingsStore((s) => s.engineMessage)
  const executablePath = useSettingsStore((s) => s.localEngineExecutablePath)
  const openSettings = useSettingsStore((s) => s.openSettings)

  const visible = deploymentMode === 'localBundle'
    && operation === 'update'
    && ACTIVE_UPDATE_PHASES.has(phase)

  if (!visible) return null

  const failed = phase === 'error'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="local-engine-update-title"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl">
        <div className="px-4 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                failed ? 'bg-red-400' : 'bg-sky-400 animate-pulse',
              )}
              aria-hidden
            />
            <h2 id="local-engine-update-title" className="text-sm font-semibold text-[var(--color-text-primary)]">
              {failed ? 'Local engine update failed' : 'Updating local engine'}
            </h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            MIRA is replacing the background engine with the version bundled in this app.
          </p>
        </div>

        <div className="px-4 py-3 space-y-2 text-xs">
          <p className="text-[var(--color-text-primary)]">
            Phase: <span className="font-medium">{phase}</span>
          </p>
          {message && (
            <p className={cn('leading-relaxed', failed ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
              {message}
            </p>
          )}
          {executablePath && (
            <p className="break-all text-[11px] text-[var(--color-text-muted)]">
              Executable: {executablePath}
            </p>
          )}
        </div>

        {failed && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end">
            <button
              type="button"
              onClick={openSettings}
              className="h-7 px-3 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            >
              Open settings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
