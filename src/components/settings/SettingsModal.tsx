import { useState, useEffect } from 'react'
import { useSettingsStore, type Theme, type Language } from '@/stores/settingsStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export function SettingsModal() {
  const store = useSettingsStore()
  const { settingsOpen, closeSettings, language: lang } = store

  const [draft, setDraft] = useState({
    workspacePath: store.workspacePath,
    theme: store.theme,
    language: store.language,
    apiUrl: store.apiUrl,
    wsUrl: store.wsUrl,
  })

  useEffect(() => {
    if (settingsOpen) {
      setDraft({
        workspacePath: store.workspacePath,
        theme: store.theme,
        language: store.language,
        apiUrl: store.apiUrl,
        wsUrl: store.wsUrl,
      })
    }
  }, [settingsOpen, store.workspacePath, store.theme, store.language, store.apiUrl, store.wsUrl])

  if (!settingsOpen) return null

  const handleSave = () => {
    store.setWorkspacePath(draft.workspacePath)
    store.setTheme(draft.theme)
    store.setLanguage(draft.language)
    store.setApiUrl(draft.apiUrl)
    store.setWsUrl(draft.wsUrl)
    closeSettings()
  }

  const curLang = draft.language

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={closeSettings}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />

      {/* Modal */}
      <div
        className="relative w-[520px] max-h-[80vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
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
