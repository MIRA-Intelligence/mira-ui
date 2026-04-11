import { useState, useEffect } from 'react'
import { useSettingsStore, type Theme, type Language } from '@/stores/settingsStore'
import { probeEngineCompatibility } from '@/services/engine'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export function SettingsModal() {
  const store = useSettingsStore()
  const { settingsOpen, closeSettings, language: lang } = store
  const showEngineWarning = store.engineStatus === 'incompatible' || store.engineStatus === 'unreachable'

  const [draft, setDraft] = useState({
    workspacePath: store.workspacePath,
    theme: store.theme,
    language: store.language,
    apiUrl: store.apiUrl,
    wsUrl: store.wsUrl,
    showProgressMessages: store.showProgressMessages,
    showToolCallHistory: store.showToolCallHistory ?? true,
  })
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null)
  const [upgradeError, setUpgradeError] = useState(false)

  useEffect(() => {
    if (settingsOpen) {
      setDraft({
        workspacePath: store.workspacePath,
        theme: store.theme,
        language: store.language,
        apiUrl: store.apiUrl,
        wsUrl: store.wsUrl,
        showProgressMessages: store.showProgressMessages,
        showToolCallHistory: store.showToolCallHistory ?? true,
      })
      setUpgrading(false)
      setUpgradeError(false)
      setUpgradeMessage(null)
    }
  }, [
    settingsOpen,
    store.workspacePath,
    store.theme,
    store.language,
    store.apiUrl,
    store.wsUrl,
    store.showProgressMessages,
    store.showToolCallHistory,
  ])

  if (!settingsOpen) return null

  const handleSave = () => {
    store.setWorkspacePath(draft.workspacePath)
    store.setTheme(draft.theme)
    store.setLanguage(draft.language)
    store.setApiUrl(draft.apiUrl)
    store.setWsUrl(draft.wsUrl)
    store.setShowProgressMessages(draft.showProgressMessages)
    store.setShowToolCallHistory(draft.showToolCallHistory)

    // Notify gateway of workspace path change
    fetch(`${draft.apiUrl}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects_root: draft.workspacePath }),
    }).catch(() => {})

    closeSettings()
  }

  const handleUpgradeEngine = async () => {
    setUpgradeError(false)
    setUpgradeMessage('Upgrading local engine...')
    setUpgrading(true)
    try {
      if (!window.electronAPI?.upgradeLocalEngine) {
        setUpgradeError(true)
        setUpgradeMessage('Desktop upgrade is unavailable in browser mode. Run: medpilot-agent upgrade --package medpilot')
        return
      }

      const result = await window.electronAPI.upgradeLocalEngine('medpilot')
      if (!result.ok) {
        setUpgradeError(true)
        setUpgradeMessage(result.stderr || 'Local engine upgrade failed.')
        return
      }

      const probe = await probeEngineCompatibility(draft.apiUrl)
      store.setEngineBootstrap({
        status: probe.status,
        message: probe.status === 'compatible' ? null : probe.message,
        version: probe.version,
      })

      if (probe.status === 'compatible') {
        setUpgradeMessage('Local engine upgraded and verified. Reconnecting...')
        setTimeout(() => window.location.reload(), 800)
      } else {
        setUpgradeError(true)
        setUpgradeMessage(`Upgrade finished but verification failed: ${probe.message}`)
      }
    } finally {
      setUpgrading(false)
    }
  }

  const curLang = draft.language

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />

      {/* Modal */}
      <div
        className="relative w-[520px] max-h-[80vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {t('settings', curLang)}
          </h2>
          <button
            onClick={closeSettings}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* ── Workspace ─────────────────────── */}
          <Section title={t('workspace', curLang)}>
            <Label text={t('workspacePath', curLang)} />
            <input
              value={draft.workspacePath}
              onChange={(e) => setDraft({ ...draft, workspacePath: e.target.value })}
              className={inputClass}
            />
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('workspacePathHint', curLang)}
            </p>
          </Section>

          {/* ── General ───────────────────────── */}
          <Section title={t('general', curLang)}>
            {/* Theme */}
            <Label text={t('theme', curLang)} />
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((th) => (
                <button
                  key={th}
                  onClick={() => setDraft({ ...draft, theme: th as Theme })}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg border transition-colors',
                    draft.theme === th
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {th === 'dark' ? '🌙 ' : '☀️ '}{t(th, curLang)}
                </button>
              ))}
            </div>

            {/* Language */}
            <Label text={t('language', curLang)} className="mt-4" />
            <div className="flex gap-2">
              {([
                { value: 'en' as Language, label: 'English' },
                { value: 'zh' as Language, label: '中文' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDraft({ ...draft, language: opt.value })}
                  className={cn(
                    'flex-1 py-2 text-sm rounded-lg border transition-colors',
                    draft.language === opt.value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Progress messages */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <Label text={t('progressMessages', curLang)} className="mb-0" />
              <button
                type="button"
                role="switch"
                aria-checked={draft.showProgressMessages}
                onClick={() => setDraft({ ...draft, showProgressMessages: !draft.showProgressMessages })}
                className={cn(
                  'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
                  draft.showProgressMessages
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-tertiary)]',
                )}
              >
                <span
                  className={cn(
                    'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                    draft.showProgressMessages ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('progressMessagesHint', curLang)}
            </p>

            {/* Tool-call history */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <Label text={t('toolCallHistory', curLang)} className="mb-0" />
              <button
                type="button"
                role="switch"
                aria-checked={draft.showToolCallHistory}
                onClick={() => setDraft({ ...draft, showToolCallHistory: !draft.showToolCallHistory })}
                className={cn(
                  'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
                  draft.showToolCallHistory
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-tertiary)]',
                )}
              >
                <span
                  className={cn(
                    'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                    draft.showToolCallHistory ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              {t('toolCallHistoryHint', curLang)}
            </p>
          </Section>

          {/* ── Connection ────────────────────── */}
          <Section title={t('connection', curLang)}>
            <Label text={t('apiUrl', curLang)} />
            <input
              value={draft.apiUrl}
              onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
              className={inputClass}
            />
            <Label text={t('wsUrl', curLang)} className="mt-3" />
            <input
              value={draft.wsUrl}
              onChange={(e) => setDraft({ ...draft, wsUrl: e.target.value })}
              className={inputClass}
            />
            {showEngineWarning && (
              <p className="text-[11px] text-amber-300 mt-3 leading-relaxed">
                {store.engineMessage || 'Local engine is unavailable or incompatible. Upgrade and restart medpilot-agent.'}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleUpgradeEngine}
                disabled={upgrading}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  upgrading
                    ? 'opacity-60 cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)]'
                    : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10',
                )}
              >
                {upgrading ? 'Upgrading...' : 'Upgrade local engine'}
              </button>
              {upgradeMessage && (
                <span className={cn('text-[11px]', upgradeError ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
                  {upgradeMessage}
                </span>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={closeSettings}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {t('cancel', curLang)}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent)]/80 transition-colors"
          >
            {t('save', curLang)}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

function Label({ text, className }: { text: string; className?: string }) {
  return (
    <label className={cn('block text-sm text-[var(--color-text-secondary)] mb-1.5', className)}>
      {text}
    </label>
  )
}

const inputClass =
  'w-full bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'
