import { useEffect, useState } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import type { SkillPluginScope, SkillPluginToggleState } from '@/types'

export function SkillsPluginsModal() {
  const { skillsPluginsOpen, closeSkillsPlugins } = useUiStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
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
  } = useSkillPluginsStore()
  const [zipInputKey, setZipInputKey] = useState(0)

  useEffect(() => {
    if (!skillsPluginsOpen || !selectedTaskId) return
    load(selectedTaskId)
  }, [skillsPluginsOpen, selectedTaskId, load])

  if (!skillsPluginsOpen) return null

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={closeSkillsPlugins}>
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />
      <div
        className="relative w-[720px] max-h-[85vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Skills Plugins
          </h2>
          <button
            onClick={closeSkillsPlugins}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Select a project in the queue to manage skill plugins.
            </p>
          )}

          {canManagePlugins && (
            <div className="space-y-4">
              <Section title="Install from local directory">
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
              </Section>

              <Section title="Install from zip">
                <input
                  key={zipInputKey}
                  type="file"
                  accept=".zip"
                  onChange={(e) => void handleZipUpload(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-[var(--color-text-secondary)]"
                />
              </Section>

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
                          {plugin.source.type !== 'builtin' && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void uninstall(selectedTaskId, plugin.id)}
                              className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
                            >
                              Uninstall
                            </button>
                          )}
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
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
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

const inputClass =
  'w-full bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'
