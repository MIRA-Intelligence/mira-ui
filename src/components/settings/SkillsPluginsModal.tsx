import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { SkillPlugin, SkillPluginGroup, SkillPluginScope, SkillPluginToggleState } from '@/types'
import { t } from '@/i18n'

export function SkillsPluginsModal() {
  const { skillsPluginsOpen, closeSkillsPlugins } = useUiStore()
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const lang = useSettingsStore((s) => s.language)
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!skillsPluginsOpen || !selectedTaskId) return
    load(selectedTaskId)
  }, [skillsPluginsOpen, selectedTaskId, load])

  if (!skillsPluginsOpen) return null

  const canManagePlugins = !!selectedTaskId
  const builtInPlugin = plugins.find((plugin) => plugin.source.type === 'builtin')
  const customPlugins = plugins.filter((plugin) => plugin.source.type !== 'builtin')

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />
      <div
        className="relative w-[760px] max-h-[88vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('skillsPlugins', lang)}</h2>
          <button
            onClick={closeSkillsPlugins}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <Label text={t('scope', lang)} className="mb-0" />
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', scope === 'project' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
                {t('project', lang)}
              </span>
              <Switch
                checked={scope === 'global'}
                onChange={(checked) => setScope(checked ? 'global' : 'project')}
                disabled={loading}
              />
              <span className={cn('text-xs', scope === 'global' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
                {t('global', lang)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">{t('projectScopeOverridesGlobal', lang)}</p>

          {!canManagePlugins && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('selectProjectToManagePlugins', lang)}</p>
          )}

          {canManagePlugins && (
            <div className="space-y-4">
              <Section title={t('installFromLocalDirectory', lang)}>
                <div className="flex gap-2">
                  <input
                    value={installPath}
                    onChange={(e) => setInstallPath(e.target.value)}
                    placeholder={t('installPathPlaceholder', lang)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleInstallDirectory}
                    className="px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
                  >
                    {t('install', lang)}
                  </button>
                </div>
              </Section>

              <Section title={t('installFromZip', lang)}>
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
                  <button type="button" onClick={clearError} className="text-red-200 hover:text-white">
                    ×
                  </button>
                </div>
              )}

              {plugins.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">{t('noInstalledPlugins', lang)}</p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('builtInSkills', lang)}</p>
                      <span className="text-[11px] text-[var(--color-text-muted)]">{t('pluginCount', lang, { count: builtInPlugin ? 1 : 0 })}</span>
                    </div>
                    {builtInPlugin ? (
                      <PluginCard
                        key={builtInPlugin.id}
                        plugin={builtInPlugin}
                        lang={lang}
                        scope={scope}
                        loading={loading}
                        expandedGroups={expandedGroups}
                        setExpandedGroups={setExpandedGroups}
                        onToggle={async (targetType, pluginId, enabled, targetId) => {
                          if (!selectedTaskId) return
                          await toggle(selectedTaskId, targetType, pluginId, enabled, targetId)
                        }}
                        onUninstall={async (pluginId) => {
                          if (!selectedTaskId) return
                          await uninstall(selectedTaskId, pluginId)
                        }}
                      />
                    ) : (
                      <p className="text-xs text-[var(--color-text-muted)]">{t('builtInSkillsUnavailable', lang)}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('custom', lang)}</p>
                      <span className="text-[11px] text-[var(--color-text-muted)]">{t('pluginCount', lang, { count: customPlugins.length })}</span>
                    </div>
                    {customPlugins.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">{t('noCustomPluginsInstalled', lang)}</p>
                    ) : (
                      <div className="space-y-2">
                        {customPlugins.map((plugin) => (
                          <PluginCard
                            key={plugin.id}
                            plugin={plugin}
                            lang={lang}
                            scope={scope}
                            loading={loading}
                            expandedGroups={expandedGroups}
                            setExpandedGroups={setExpandedGroups}
                            onToggle={async (targetType, pluginId, enabled, targetId) => {
                              if (!selectedTaskId) return
                              await toggle(selectedTaskId, targetType, pluginId, enabled, targetId)
                            }}
                            onUninstall={async (pluginId) => {
                              if (!selectedTaskId) return
                              await uninstall(selectedTaskId, pluginId)
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PluginCard({
  plugin,
  lang,
  scope,
  loading,
  expandedGroups,
  setExpandedGroups,
  onToggle,
  onUninstall,
}: {
  plugin: SkillPlugin
  lang: ReturnType<typeof useSettingsStore.getState>['language']
  scope: SkillPluginScope
  loading: boolean
  expandedGroups: Record<string, boolean>
  setExpandedGroups: Dispatch<SetStateAction<Record<string, boolean>>>
  onToggle: (
    targetType: 'group' | 'skill',
    pluginId: string,
    enabled: boolean,
    targetId?: string,
  ) => Promise<void>
  onUninstall: (pluginId: string) => Promise<void>
}) {
  const pluginChecked = scopeValue(plugin.enabled, scope)
  const pluginGroups = plugin.groups
  const groupedSkillIds = new Set(pluginGroups.flatMap((group) => group.skill_ids))
  const ungroupedSkills = useMemo(
    () => plugin.skills.filter((skill) => !groupedSkillIds.has(skill.id)),
    [plugin.skills, pluginGroups],
  )
  const hasGroupedSkills = pluginGroups.length > 0
  const isBuiltin = plugin.source.type === 'builtin'

  return (
    <div className="space-y-2">
      {pluginGroups.map((group, index) => {
        const key = `${plugin.id}:${group.id}`
        const open = expandedGroups[key] ?? false
        const groupSkills = plugin.skills.filter((skill) => skill.group_ids.includes(group.id))
        const groupChecked = scopeValue(group.enabled, scope)
        const paused = isGroupPaused(group, groupSkills, scope)
        return (
          <div key={key} className="rounded-md border border-[var(--color-border)]/70 bg-[var(--color-bg-secondary)]/20">
            <div className="flex items-center justify-between px-3 py-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={open}
                  onChange={(e) => {
                    const next = e.target.checked
                    setExpandedGroups((prev) => ({ ...prev, [key]: next }))
                  }}
                />
                <span className={cn('text-xs transition-transform', open ? 'rotate-90' : 'rotate-0')}>▶</span>
                <span className="text-sm text-[var(--color-text-primary)] truncate">
                  {group.name} <span className="text-[11px] text-[var(--color-text-muted)]">({groupSkills.length})</span>
                </span>
              </label>
              <div className="flex items-center gap-2">
                <LabeledSwitch
                  label=""
                  checked={groupChecked}
                  disabled={loading}
                  tone={paused ? 'warning' : 'default'}
                  onChange={(_next) => {
                    const applyValue = paused ? groupChecked : !groupChecked
                    void onToggle('group', plugin.id, applyValue, group.id)
                  }}
                />
                {!isBuiltin && index === 0 && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void onUninstall(plugin.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-red-300 disabled:opacity-60"
                    aria-label={t('uninstall', lang)}
                    title={t('uninstall', lang)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {paused && (
              <p className="px-3 pb-2 text-[11px] text-amber-300">
                {t('groupSwitchPausedHint', lang)}
              </p>
            )}
            {open && (
              <div className="px-3 pb-3 space-y-1">
                {groupSkills.map((skill) => (
                  <LabeledSwitch
                    key={`${plugin.id}-${group.id}-${skill.id}`}
                    label={t('skillLabel', lang, { name: skill.name })}
                    switchSize="sm"
                    checked={pluginChecked && groupAwareSkillState(skill, group, scope)}
                    disabled={loading}
                    onChange={(checked) => void onToggle('skill', plugin.id, checked, skill.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {ungroupedSkills.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)]/70 px-3 py-2 space-y-1">
          {hasGroupedSkills && <p className="text-xs text-[var(--color-text-muted)]">{t('ungrouped', lang)}</p>}
          {!isBuiltin && !hasGroupedSkills
            ? ungroupedSkills.map((skill, index) => (
                <div key={`${plugin.id}-ungrouped-${skill.id}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t('skillLabel', lang, { name: skill.name })}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      size="sm"
                      checked={pluginChecked && scopeValue(skill.enabled, scope)}
                      disabled={loading}
                      onChange={(checked) => void onToggle('skill', plugin.id, checked, skill.id)}
                    />
                    {index === 0 && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void onUninstall(plugin.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-red-300 disabled:opacity-60"
                        aria-label={t('uninstall', lang)}
                        title={t('uninstall', lang)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))
            : ungroupedSkills.map((skill) => (
                <LabeledSwitch
                  key={`${plugin.id}-ungrouped-${skill.id}`}
                  label={t('skillLabel', lang, { name: skill.name })}
                  switchSize="sm"
                  checked={pluginChecked && scopeValue(skill.enabled, scope)}
                  disabled={loading}
                  onChange={(checked) => void onToggle('skill', plugin.id, checked, skill.id)}
                />
              ))}
        </div>
      )}
    </div>
  )
}

function isGroupPaused(
  group: SkillPluginGroup,
  skills: Array<{ enabled: SkillPluginToggleState }>,
  scope: SkillPluginScope,
): boolean {
  const groupState = scopeValue(group.enabled, scope)
  const mismatch = skills.some((skill) => {
    const skillState = groupAwareSkillState(skill, group, scope)
    return skillState !== groupState
  })
  return mismatch
}

function isSkillExplicitAtScope(state: SkillPluginToggleState, scope: SkillPluginScope): boolean {
  return scope === 'global' ? !!state.global_explicit : !!state.project_explicit
}

function groupAwareSkillState(
  skill: { enabled: SkillPluginToggleState },
  group: SkillPluginGroup,
  scope: SkillPluginScope,
): boolean {
  const explicit = isSkillExplicitAtScope(skill.enabled, scope)
  if (explicit) {
    return scopeValue(skill.enabled, scope)
  }
  return scopeValue(group.enabled, scope)
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

function LabeledSwitch({
  label,
  checked,
  disabled,
  tone = 'default',
  switchSize = 'md',
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  tone?: 'default' | 'warning'
  switchSize?: 'md' | 'sm'
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      {label ? <span className="text-[var(--color-text-secondary)]">{label}</span> : <span />}
      <Switch size={switchSize} checked={checked} disabled={disabled} tone={tone} onChange={onChange} />
    </div>
  )
}

function Switch({
  size = 'md',
  checked,
  disabled,
  tone = 'default',
  onChange,
}: {
  size?: 'md' | 'sm'
  checked: boolean
  disabled?: boolean
  tone?: 'default' | 'warning'
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={cn('relative inline-flex items-center', disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn(
          'rounded-full transition-colors',
          size === 'sm' ? 'h-4 w-8' : 'h-5 w-10',
          checked
            ? tone === 'warning'
              ? 'bg-amber-500/70'
              : 'bg-[var(--color-accent)]'
            : 'bg-[var(--color-bg-tertiary)]',
        )}
      />
      <span
        className={cn(
          'absolute rounded-full bg-white shadow-sm transition-transform',
          size === 'sm'
            ? 'left-[1px] top-[1px] h-3.5 w-3.5'
            : 'left-[2px] top-[2px] h-4 w-4',
          checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0',
        )}
      />
    </label>
  )
}

const inputClass =
  'w-full bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'
