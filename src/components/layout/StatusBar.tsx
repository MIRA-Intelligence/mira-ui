import { useEffect, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUiStore, type SystemMessageSeverity } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const SYSTEM_MESSAGE_TICK_MS = 500

export function StatusBar() {
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const engineStatus = useSettingsStore((s) => s.engineStatus)
  const engineMessage = useSettingsStore((s) => s.engineMessage)
  const engineVersion = useSettingsStore((s) => s.engineVersion)
  const localEnginePhase = useSettingsStore((s) => s.localEnginePhase)
  const runtimeConfig = useSettingsStore((s) => s.runtimeConfig)
  const connected = useAgentStore((s) => s.connected)

  const showEngineWarning =
    deploymentMode === 'localBundle' &&
    (engineStatus === 'incompatible' ||
      engineStatus === 'unreachable' ||
      engineStatus === 'setup_required' ||
      localEnginePhase === 'error')

  const engineLabel = useMemo(() => {
    const versionLabel = engineVersion ? `mira-engine ${engineVersion}` : 'mira-engine'
    return versionLabel
  }, [engineVersion])

  const modelLabel = runtimeConfig?.runtime?.model ?? null

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {showEngineWarning && (
        <div className="px-6 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-500/30">
          {engineMessage || t('engineWarningFallback', lang)}
        </div>
      )}
      <div className="flex items-stretch h-[22px] px-3 gap-2 text-[11px] text-[var(--color-text-muted)]">
        <SystemMessageSlot />

        <div className="flex items-stretch gap-0.5 shrink-0">
          <EngineChip
            label={engineLabel}
            status={engineStatus}
            phase={localEnginePhase}
            message={engineMessage}
            statusLabel={t(engineStatusKey(engineStatus, localEnginePhase), lang)}
          />
          {modelLabel ? (
            <ModelChip model={modelLabel} provider={runtimeConfig?.runtime?.provider ?? null} />
          ) : (
            <Chip
              title={t('noModelConfigured', lang)}
              className="opacity-60"
            >
              <span className="truncate">{t('noModelConfigured', lang)}</span>
            </Chip>
          )}
          <WsChip connected={connected} label={t(connected ? 'wsConnectedShort' : 'wsDisconnectedShort', lang)} />
        </div>
      </div>
    </footer>
  )
}

function SystemMessageSlot() {
  const messages = useUiStore((s) => s.systemMessages)
  const clearExpired = useUiStore((s) => s.clearExpiredSystemMessages)

  useEffect(() => {
    if (messages.length === 0) return
    const id = setInterval(() => clearExpired(), SYSTEM_MESSAGE_TICK_MS)
    return () => clearInterval(id)
  }, [messages.length, clearExpired])

  const current = messages[messages.length - 1]
  if (!current) {
    return <div className="flex-1 min-w-0" aria-hidden />
  }

  return (
    <div
      className="flex-1 min-w-0 flex items-center gap-1.5"
      role="status"
      aria-live="polite"
    >
      <span
        className={cn('w-1.5 h-1.5 rounded-full shrink-0', severityDotClass(current.severity))}
        aria-hidden
      />
      <span
        className={cn('truncate', severityTextClass(current.severity))}
        title={current.text}
      >
        {current.text}
      </span>
    </div>
  )
}

function Chip({
  children,
  title,
  onClick,
  className,
}: {
  children: React.ReactNode
  title?: string
  onClick?: () => void
  className?: string
}) {
  const Component = onClick ? 'button' : 'div'
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-1.5 px-2 h-full max-w-[200px] truncate',
        onClick && 'hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer',
        className,
      )}
    >
      {children}
    </Component>
  )
}

function EngineChip({
  label,
  status,
  phase,
  message,
  statusLabel,
}: {
  label: string
  status: ReturnType<typeof useSettingsStore.getState>['engineStatus']
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase']
  message: string | null
  statusLabel: string
}) {
  const dotClass = engineDotClass(status, phase)
  const tooltipParts = [statusLabel]
  if (message) tooltipParts.push(message)
  return (
    <Chip title={tooltipParts.join(' — ')}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClass)} aria-hidden />
      <span className="truncate">{label}</span>
    </Chip>
  )
}

function ModelChip({ model, provider }: { model: string; provider: string | null }) {
  const tooltip = provider ? `${provider} · ${model}` : model
  return (
    <Chip title={tooltip}>
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0 opacity-70"
      >
        <path d="M12 2a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3v0a3 3 0 0 0 3 3v0a3 3 0 0 0 3 3v0a3 3 0 0 0 3-3v0a3 3 0 0 0 3-3v0a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3v0a3 3 0 0 0-3-3v0a3 3 0 0 0-3-3z" />
      </svg>
      <span className="truncate">{model}</span>
    </Chip>
  )
}

function WsChip({ connected, label }: { connected: boolean; label: string }) {
  return (
    <Chip title={label}>
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          connected ? 'bg-emerald-400' : 'bg-slate-500',
        )}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </Chip>
  )
}

function engineDotClass(
  status: ReturnType<typeof useSettingsStore.getState>['engineStatus'],
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase'],
): string {
  if (phase === 'checking' || phase === 'installing' || phase === 'starting') {
    return 'bg-sky-400 animate-pulse'
  }
  if (status === 'compatible') return 'bg-emerald-400'
  if (
    status === 'incompatible' ||
    status === 'unreachable' ||
    status === 'setup_required' ||
    phase === 'error'
  ) {
    return 'bg-red-400'
  }
  return 'bg-slate-500'
}

function engineStatusKey(
  status: ReturnType<typeof useSettingsStore.getState>['engineStatus'],
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase'],
):
  | 'engineStatusReady'
  | 'engineStatusBooting'
  | 'engineStatusError'
  | 'engineStatusSetupRequired'
  | 'engineStatusUnreachable'
  | 'engineStatusUnknown' {
  if (phase === 'checking' || phase === 'installing' || phase === 'starting') {
    return 'engineStatusBooting'
  }
  if (phase === 'error') return 'engineStatusError'
  if (status === 'compatible') return 'engineStatusReady'
  if (status === 'setup_required') return 'engineStatusSetupRequired'
  if (status === 'unreachable' || status === 'incompatible') return 'engineStatusUnreachable'
  return 'engineStatusUnknown'
}

function severityDotClass(severity: SystemMessageSeverity): string {
  switch (severity) {
    case 'success':
      return 'bg-emerald-400'
    case 'warning':
      return 'bg-amber-400'
    case 'error':
      return 'bg-red-400'
    default:
      return 'bg-sky-400'
  }
}

function severityTextClass(severity: SystemMessageSeverity): string {
  switch (severity) {
    case 'success':
      return 'text-emerald-300'
    case 'warning':
      return 'text-amber-300'
    case 'error':
      return 'text-red-300'
    default:
      return 'text-[var(--color-text-secondary)]'
  }
}
