import { useState, useEffect } from 'react'
import { useSettingsStore, type Theme, type Language } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SkillPluginScope, SkillPluginToggleState } from '@/types'

export function SettingsModal() {
  const store = useSettingsStore()
  const { settingsOpen, closeSettings, language: lang } = store
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const pluginsStore = useSkillPluginsStore()
  const {
    plugins,
    scope,
    loading,
    error,
    installPath,
    setScope,
    setInstallPath,
    clearError,
    load,
    installFromDirectory,
    installFromZip,
    toggle,
    uninstall,
  } = pluginsStore

  const [draft, setDraft] = useState({
    workspacePath: store.workspacePath,
    theme: store.theme,
    language: store.language,
    apiUrl: store.apiUrl,
    wsUrl: store.wsUrl,
    showProgressMessages: store.showProgressMessages,
  })
  const [zipInputKey, setZipInputKey] = useState(0)

  useEffect(() => {
    if (settingsOpen) {
      setDraft({
        workspacePath: store.workspacePath,
        theme: store.theme,
        language: store.language,
        apiUrl: store.apiUrl,
        wsUrl: store.wsUrl,
        showProgressMessages: store.showProgressMessages,
      })
    }
  }, [
    settingsOpen,
    store.workspacePath,
    store.theme,
    store.language,
    store.apiUrl,
    store.wsUrl,
    store.showProgressMessages,
  ])

  useEffect(() => {
    if (!settingsOpen) return
    if (!selectedTaskId) return
    load(selectedTaskId)
  }, [settingsOpen, selectedTaskId, load])

  if (!settingsOpen) return null

  const handleSave = () => {
    store.setWorkspacePath(draft.workspacePath)
    store.setTheme(draft.theme)
    store.setLanguage(draft.language)
    store.setApiUrl(draft.apiUrl)
    store.setWsUrl(draft.wsUrl)
    store.setShowProgressMessages(draft.showProgressMessages)

    // Notify gateway of workspace path change
    fetch(`${draft.apiUrl}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects_root: draft.workspacePath }),
    }).catch(() => {})

    closeSettings()
  }

  const curLang = draft.language
  const canManagePlugins = !!selectedTaskId

  const handleInstallDirectory = async () => {
    if (!selectedTaskId) return
    await installFromDirectory(selectedTaskId)
  }

  const handleZipUpload = async (file: File | null) => {
    if (!selectedTaskId || !file) return
    await installFromZip(selectedTaskId, file)
    setZipInputKey((v) => v + 1)
  }

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

          <Section title="Skill Plugins">
            <div className="flex items-center justify-between gap-2">
              <Label text="Scope" className="mb-0" />
              <div className="flex gap-2">
                {(['project', 'global'] as const).map((nextScope) => (
                  <button
                    key={nextScope}
                    type="button"
                    onClick={() => setScope(nextScope)}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-md border transition-colors',
                      scope === nextScope
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
                    )}
                  >
                    {nextScope}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              Project scope overrides global scope.
            </p>

            {!canManagePlugins && (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Select a project in the queue to manage skill plugins.
              </p>
            )}

            {canManagePlugins && (
              <div className="mt-3 space-y-3">
                <Label text="Install from local directory" />
                <div className="flex gap-2">
                  <input
                    value={installPath}
                    onChange={(e) => setInstallPath(e.target.value)}
                    placeholder="/path/to/plugin"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleInstallDirectory}
                    className="px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
                  >
                    Install
                  </button>
                </div>

                <Label text="Install from zip" />
                <input
                  key={zipInputKey}
                  type="file"
                  accept=".zip"
                  onChange={(e) => void handleZipUpload(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-[var(--color-text-secondary)]"
                />

                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center justify-between gap-2">
                    <span>{error}</span>
                    <button
                      type="button"
                      onClick={clearError}
                      className="text-red-200 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                )}

                {plugins.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">No installed plugins.</p>
                ) : (
                  <div className="space-y-3">
                    {plugins.map((plugin) => (
                      <div
                        key={plugin.id}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">
                              {plugin.name} <span className="text-xs text-[var(--color-text-muted)]">@{plugin.version}</span>
                            </p>
                            <p className="text-[11px] text-[var(--color-text-muted)]">{plugin.id}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <ToggleButton
                              state={plugin.enabled}
                              scope={scope}
                              label="Plugin"
                              disabled={loading}
                              onToggle={(nextEnabled) => void toggle(
                                selectedTaskId,
                                'plugin',
                                plugin.id,
                                nextEnabled,
                              )}
                            />
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void uninstall(selectedTaskId, plugin.id)}
                              className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
                            >
                              Uninstall
                            </button>
                          </div>
                        </div>

                        {plugin.groups.length > 0 && (
                          <div className="space-y-1">
                            {plugin.groups.map((group) => (
                              <ToggleButton
                                key={`${plugin.id}-group-${group.id}`}
                                state={group.enabled}
                                scope={scope}
                                label={`Group: ${group.name}`}
                                disabled={loading}
                                onToggle={(nextEnabled) => void toggle(
                                  selectedTaskId,
                                  'group',
                                  plugin.id,
                                  nextEnabled,
                                  group.id,
                                )}
                              />
                            ))}
                          </div>
                        )}

                        <div className="space-y-1">
                          {plugin.skills.map((skill) => (
                            <ToggleButton
                              key={`${plugin.id}-skill-${skill.id}`}
                              state={skill.enabled}
                              scope={scope}
                              label={`Skill: ${skill.id}`}
                              disabled={loading}
                              onToggle={(nextEnabled) => void toggle(
                                selectedTaskId,
                                'skill',
                                plugin.id,
                                nextEnabled,
                                skill.id,
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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

function scopeValue(state: SkillPluginToggleState, scope: SkillPluginScope): boolean {
  if (scope === 'global') return state.global
  return state.project ?? state.global
}

function ToggleButton({
  label,
  scope,
  state,
  disabled,
  onToggle,
}: {
  label: string
  scope: SkillPluginScope
  state: SkillPluginToggleState
  disabled?: boolean
  onToggle: (enabled: boolean) => void
}) {
  const current = scopeValue(state, scope)
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(!current)}
        className={cn(
          'px-2.5 py-1 rounded-md border transition-colors disabled:opacity-60',
          current
            ? 'border-green-500/30 bg-green-500/10 text-green-300'
            : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
        )}
      >
        {current ? 'Enabled' : 'Disabled'}
      </button>
    </div>
  )
}
