import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore, type SystemMessageSeverity } from '@/stores/uiStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chatStore'
import { SkillHistoryChip } from './SkillHistoryChip'
import { useTokenUsageStore, type TokenUsage } from '@/stores/tokenUsageStore'

const SYSTEM_MESSAGE_TICK_MS = 500

export function StatusBar() {
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const engineStatus = useSettingsStore((s) => s.engineStatus)
  const engineMessage = useSettingsStore((s) => s.engineMessage)
  const engineVersion = useSettingsStore((s) => s.engineVersion)
  const connectionMessage = useSettingsStore((s) => s.connectionMessage)
  const localEnginePhase = useSettingsStore((s) => s.localEnginePhase)
  const runtimeConfig = useSettingsStore((s) => s.runtimeConfig)
  const connected = useAgentStore((s) => s.connected)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const appMode = useProjectStore((s) => s.appMode)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const skillSessionId = appMode === 'normal' ? activeChatId : selectedTaskId
  const workspace = useSettingsStore((s) => s.workspacePath)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const usage = useAgentStore((s) =>
    skillSessionId ? s.usageBySession[skillSessionId] ?? null : null,
  )
  const tokenUsage = useTokenUsageStore((s) => skillSessionId ? s.snapshots[skillSessionId] : undefined)
  const loadUsage = useTokenUsageStore((s) => s.load)
  useEffect(() => {
    if (connected && skillSessionId) void loadUsage(skillSessionId)
  }, [connected, skillSessionId, workspace, apiUrl, loadUsage])

  const bannerMessage = connectionMessage || engineMessage
  const showEngineWarning = Boolean(bannerMessage) && (
    engineStatus === 'incompatible'
      || engineStatus === 'unreachable'
      || engineStatus === 'setup_required'
      || localEnginePhase === 'error'
      || !connected
      || deploymentMode === 'remoteManual'
  )

  const engineLabel = useMemo(() => {
    const versionLabel = engineVersion ? `mira-engine ${engineVersion}` : 'mira-engine'
    return versionLabel
  }, [engineVersion])
  const engineChipLabel = isEnginePhaseDisplayable(localEnginePhase)
    ? `Phase: ${localEnginePhase}`
    : engineLabel

  const modelLabel = runtimeConfig?.runtime?.model ?? null

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {showEngineWarning && (
        <div className="px-6 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-500/30">
          {bannerMessage || t('engineWarningFallback', lang)}
        </div>
      )}
      <div className="flex items-stretch h-[22px] px-3 gap-2 text-[11px] text-[var(--color-text-muted)]">
        {skillSessionId && <SkillHistoryChip key={`${apiUrl}:${workspace}:${skillSessionId}`} sessionId={skillSessionId} />}
        {skillSessionId && <TokenChip key={`tokens:${apiUrl}:${workspace}:${skillSessionId}`} tokensUsed={tokenUsage?.total_tokens ?? usage?.tokensUsed ?? null}
          maxTokens={tokenUsage ? null : usage?.maxTokens ?? null} snapshot={tokenUsage} lang={lang} />}
        <SystemMessageSlot />

        <div className="flex items-stretch gap-0.5 shrink-0">
          <EngineChip
            label={engineChipLabel}
            status={engineStatus}
            phase={localEnginePhase}
            message={engineMessage}
            engineLabel={engineLabel}
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
          <WsChip
            connected={connected}
            label={t(connected ? 'wsConnectedShort' : 'wsDisconnectedShort', lang)}
            detail={connectionMessage || (!connected ? engineMessage : null)}
          />
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
  engineLabel,
  statusLabel,
}: {
  label: string
  status: ReturnType<typeof useSettingsStore.getState>['engineStatus']
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase']
  message: string | null
  engineLabel: string
  statusLabel: string
}) {
  const dotClass = engineDotClass(status, phase)
  const tooltipParts = [engineLabel, statusLabel]
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

function TokenChip({
  tokensUsed,
  maxTokens,
  snapshot,
  lang,
}: {
  tokensUsed: number | null
  maxTokens: number | null
  snapshot?: TokenUsage
  lang: ReturnType<typeof useSettingsStore.getState>['language']
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const zh = lang === 'zh'
  const detailsLabel = zh ? 'Token 使用明细' : 'Token usage details'
  const unknownLabel = zh ? '未知' : 'Unknown'
  const cacheReported = snapshot?.cache_reported_calls ?? 0
  const cacheComplete = Boolean(snapshot && snapshot.calls > 0
    && cacheReported === snapshot.calls && snapshot.unreported_calls === 0)
  const cachedLabel = snapshot && (cacheComplete || snapshot.cached_tokens > 0)
    ? `${cacheComplete ? '' : '≥ '}${snapshot.cached_tokens.toLocaleString()}` : unknownLabel

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const usedLabel = tokensUsed === null || (snapshot?.unreported_calls && !tokensUsed) ? '—' : formatTokenCount(tokensUsed)
  const maxLabel = maxTokens != null ? formatTokenCount(maxTokens) : null
  const ratio = maxTokens && maxTokens > 0 ? (tokensUsed ?? 0) / maxTokens : 0
  const tone = tokenChipTone(ratio)
  const visibleLabel = maxLabel ? `${usedLabel} / ${maxLabel}` : `${snapshot?.unreported_calls && tokensUsed ? '≥ ' : ''}${usedLabel}`
  const tooltip = snapshot
    ? (lang === 'zh'
      ? `累计 ${snapshot.total_tokens.toLocaleString()} tokens · 输入 ${snapshot.input_tokens.toLocaleString()} · 输出 ${snapshot.output_tokens.toLocaleString()} · 缓存输入 ${cachedLabel}（已包含在输入中） · ${snapshot.calls} 次调用${snapshot.unreported_calls ? `；${snapshot.unreported_calls} 次未返回用量，统计不完整` : ''}。点击查看明细，非金额。`
      : `${snapshot.total_tokens.toLocaleString()} tokens · Input ${snapshot.input_tokens.toLocaleString()} · Output ${snapshot.output_tokens.toLocaleString()} · Cached input ${cachedLabel} (included in input) · ${snapshot.calls} calls${snapshot.unreported_calls ? `; ${snapshot.unreported_calls} calls did not report usage; incomplete` : ''}. Click for details; not a monetary cost.`)
    : tokensUsed === null ? (lang === 'zh' ? 'Token 用量尚不可用' : 'Token usage unavailable') : maxLabel
    ? t('tokenChipTooltipBudget', lang, {
        used: tokensUsed.toLocaleString(),
        max: maxTokens!.toLocaleString(),
        pct: Math.min(999, Math.round(ratio * 100)).toString(),
      })
    : t('tokenChipTooltip', lang, { used: tokensUsed.toLocaleString() })

  return (
    <div ref={root} className="relative flex shrink-0 items-stretch">
      <button ref={button} type="button" title={tooltip} aria-label={detailsLabel}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn('flex items-center gap-1.5 rounded px-2 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]', tone.text)}>
        <span aria-hidden="true">₿</span>
        <span className="truncate tabular-nums">{visibleLabel}</span>
      </button>
      {open && <section id={dialogId} role="dialog" aria-label={detailsLabel}
        className="fixed bottom-8 left-3 z-50 w-[360px] max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-xl text-[var(--color-text-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <h2 className="text-sm font-medium">{detailsLabel}</h2>
          <button ref={closeButton} type="button" aria-label={zh ? '关闭 Token 明细' : 'Close token details'}
            className="rounded px-2 py-1 hover:bg-[var(--color-bg-hover)]"
            onClick={() => { setOpen(false); button.current?.focus() }}>×</button>
        </div>
        <div className="space-y-3 p-3 text-xs">
          <p className="text-[var(--color-text-muted)]">{zh ? '当前会话累计 · 自统计启用以来' : 'Current session total · Since tracking was enabled'}</p>
          {snapshot ? <>
            <dl className="space-y-2">
              {([
                [zh ? '总 token' : 'Total tokens', `${snapshot.unreported_calls ? '≥ ' : ''}${snapshot.total_tokens.toLocaleString()}`],
                [zh ? '输入 token' : 'Input tokens', `${snapshot.unreported_calls ? '≥ ' : ''}${snapshot.input_tokens.toLocaleString()}`],
                [zh ? '输出 token' : 'Output tokens', `${snapshot.unreported_calls ? '≥ ' : ''}${snapshot.output_tokens.toLocaleString()}`],
                [zh ? '缓存命中 token（包含在输入中）' : 'Cache-read tokens (part of input)', cachedLabel],
                [zh ? '未命中缓存的输入 token' : 'Input tokens not served from cache', cacheComplete ? (snapshot.input_tokens - snapshot.cached_tokens).toLocaleString() : unknownLabel],
                [zh ? '缓存命中率（按输入 token）' : 'Cache hit rate (input tokens)', cacheComplete && snapshot.input_tokens > 0 ? `${(snapshot.cached_tokens / snapshot.input_tokens * 100).toFixed(1)}%` : '—'],
                [zh ? '模型调用次数' : 'Model calls', snapshot.calls.toLocaleString()],
                [zh ? '有缓存明细的调用' : 'Calls reporting cache usage', `${cacheReported} / ${snapshot.calls}`],
                [zh ? '未返回用量的调用' : 'Calls missing token usage', snapshot.unreported_calls.toLocaleString()],
              ] as [string, string][]).map(([label, value]) => <div key={label} className="flex justify-between gap-3">
                <dt className="text-[var(--color-text-muted)]">{label}</dt><dd className="shrink-0 tabular-nums">{value}</dd>
              </div>)}
            </dl>
            {!cacheComplete && snapshot.calls > 0 && <p className="text-amber-500">{zh
              ? '部分或全部调用缺少缓存明细（含旧版记录）。未知不代表未命中；已知缓存量仅为下限，不能推算完整命中率。'
              : 'Some or all calls lack cache details (including older records). Unknown does not mean a cache miss; known cache reads are only a lower bound.'}</p>}
            {snapshot.unreported_calls > 0 && <p className="text-amber-500">{zh ? '部分调用未返回 token 用量，累计统计不完整。' : 'Some calls did not return token usage; totals are incomplete.'}</p>}
          </> : <p>{zh ? '详细用量尚不可用。旧版统计仅提供总量，请连接支持明细的 engine。' : 'Detailed usage is unavailable. Legacy counters only provide totals; connect to an engine supporting details.'}</p>}
          <p className="text-[var(--color-text-muted)]">{zh
            ? '缓存命中仍计入输入和总量；这里显示 token 数，不是费用或账单。实际计费以供应商为准。'
            : 'Cache reads remain included in input and total tokens. These are token counts, not costs or a bill. Billing depends on the provider.'}</p>
        </div>
      </section>}
    </div>
  )
}

function tokenChipTone(ratio: number): { text: string; icon: string } {
  if (ratio >= 1) return { text: 'text-red-300', icon: 'text-red-400' }
  if (ratio >= 0.8) return { text: 'text-amber-300', icon: 'text-amber-400' }
  return { text: '', icon: 'opacity-70' }
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return value.toString()
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}K`
  if (value < 1_000_000) return `${Math.round(value / 1_000)}K`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
}

function WsChip({ connected, label, detail }: { connected: boolean; label: string; detail: string | null }) {
  return (
    <Chip title={detail ? `${label} — ${detail}` : label}>
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
  if (isEnginePhaseActive(phase)) {
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
  if (isEnginePhaseActive(phase)) {
    return 'engineStatusBooting'
  }
  if (phase === 'error') return 'engineStatusError'
  if (status === 'compatible') return 'engineStatusReady'
  if (status === 'setup_required') return 'engineStatusSetupRequired'
  if (status === 'unreachable' || status === 'incompatible') return 'engineStatusUnreachable'
  return 'engineStatusUnknown'
}

function isEnginePhaseActive(
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase'],
): boolean {
  return phase === 'checking'
    || phase === 'installing'
    || phase === 'updating'
    || phase === 'repairing'
    || phase === 'starting'
}

function isEnginePhaseDisplayable(
  phase: ReturnType<typeof useSettingsStore.getState>['localEnginePhase'],
): boolean {
  return isEnginePhaseActive(phase) || phase === 'error'
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
