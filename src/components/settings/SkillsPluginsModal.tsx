import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useSkillPluginsStore } from '@/stores/skillPluginsStore'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import type { SkillPlugin, SkillPluginGroup, SkillPluginScope, SkillPluginSkill, SkillPluginToggleState } from '@/types'

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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

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
        className="relative w-[760px] max-h-[88vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Skills Plugins</h2>
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
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', scope === 'project' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
                Project
              </span>
              <Switch
                checked={scope === 'global'}
                onChange={(checked) => setScope(checked ? 'global' : 'project')}
                disabled={loading}
              />
              <span className={cn('text-xs', scope === 'global' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]')}>
                Global
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">Project scope overrides global scope.</p>

          {!canManagePlugins && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">Select a project in the queue to manage skill plugins.</p>
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
                  <button type="button" onClick={clearError} className="text-red-200 hover:text-white">
                    ×
                  </button>
                </div>
              )}

              {plugins.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">No installed plugins.</p>
              ) : (
                <div className="space-y-3">
                  {plugins.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
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
          )}
        </div>
      </div>
    </div>
  )
}

function PluginCard({
  plugin,
  scope,
  loading,
  expandedGroups,
  setExpandedGroups,
  onToggle,
  onUninstall,
}: {
  plugin: SkillPlugin
  scope: SkillPluginScope
  loading: boolean
  expandedGroups: Record<string, boolean>
  setExpandedGroups: Dispatch<SetStateAction<Record<string, boolean>>>
  onToggle: (
    targetType: 'plugin' | 'group' | 'skill',
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

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {plugin.name} <span className="text-xs text-[var(--color-text-muted)]">@{plugin.version}</span>
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">{plugin.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <LabeledSwitch
            label="Plugin"
            checked={pluginChecked}
            disabled={loading}
            onChange={(checked) => void onToggle('plugin', plugin.id, checked)}
          />
          {plugin.source.type !== 'builtin' && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void onUninstall(plugin.id)}
              className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
            >
              Uninstall
            </button>
          )}
        </div>
      </div>

      {pluginGroups.map((group) => {
        const key = `${plugin.id}:${group.id}`
        const open = expandedGroups[key] ?? false
        const groupSkills = plugin.skills.filter((skill) => skill.group_ids.includes(group.id))
        const customized = isGroupCustomized(group, scope)
        const checked = scopeValue(group.enabled, scope)
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
              <LabeledSwitch
                label=""
                checked={checked}
                disabled={loading}
                tone={customized ? 'warning' : 'default'}
                onChange={(_next) => {
                  const applyValue = customized ? checked : !checked
                  void onToggle('group', plugin.id, applyValue, group.id)
                }}
              />
            </div>
            {customized && (
              <p className="px-3 pb-2 text-[11px] text-amber-300">
                Skill-level overrides are active; group switch is paused. Toggle this switch to apply group setting again.
              </p>
            )}
            {open && (
              <div className="px-3 pb-3 space-y-1">
                {groupSkills.map((skill) => (
                  <LabeledSwitch
                    key={`${plugin.id}-${group.id}-${skill.id}`}
                    label={`Skill: ${skill.id}`}
                    checked={scopeValue(skill.enabled, scope)}
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
          <p className="text-xs text-[var(--color-text-muted)]">Ungrouped</p>
          {ungroupedSkills.map((skill) => (
            <LabeledSwitch
              key={`${plugin.id}-ungrouped-${skill.id}`}
              label={`Skill: ${skill.id}`}
              checked={scopeValue(skill.enabled, scope)}
              disabled={loading}
              onChange={(checked) => void onToggle('skill', plugin.id, checked, skill.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function isGroupCustomized(group: SkillPluginGroup, scope: SkillPluginScope): boolean {
  const customized = group.customized
  if (!customized) return false
  return scope === 'global' ? customized.global : customized.project
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
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  tone?: 'default' | 'warning'
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      {label ? <span className="text-[var(--color-text-secondary)]">{label}</span> : <span />}
      <Switch checked={checked} disabled={disabled} tone={tone} onChange={onChange} />
    </div>
  )
}

function Switch({
  checked,
  disabled,
  tone = 'default',
  onChange,
}: {
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
          'w-10 h-5 rounded-full transition-colors',
          checked
            ? tone === 'warning'
              ? 'bg-amber-500/70'
              : 'bg-[var(--color-accent)]'
            : 'bg-[var(--color-bg-tertiary)]',
        )}
      />
      <span
        className={cn(
          'absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </label>
  )
}

const inputClass =
  'w-full bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'
