import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  fetchProviderModels,
  fetchRuntimeConfig,
  saveProvidersConfig,
  testProvider,
  TEAM_ROLES,
  type RuntimeConfigPayload,
  type TeamRole,
} from '@/services/runtimeConfig'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { ProviderIcon } from './ProviderIcon'
import { providerDescription, providerDocsUrl } from './catalog'

interface ProviderDraft {
  apiKey: string
  apiBase: string
  models: string[]
  enabled: boolean
}

interface ActiveDraft {
  provider: string
  model: string
  supervisor_provider: string
  supervisor_model: string
  student_provider: string
  student_model: string
  critic_provider: string
  critic_model: string
}

const ROLE_LABEL_KEYS: Record<TeamRole, I18nKey> = {
  supervisor: 'roleSupervisor',
  student: 'roleStudent',
  critic: 'roleCritic',
}

function buildDrafts(payload: RuntimeConfigPayload): Record<string, ProviderDraft> {
  const drafts: Record<string, ProviderDraft> = {}
  for (const [name, settings] of Object.entries(payload.providers)) {
    if (name === 'auto') continue
    drafts[name] = {
      apiKey: '',
      apiBase: settings.api_base ?? '',
      models: [...(settings.models ?? [])],
      enabled: Boolean(settings.enabled),
    }
  }
  return drafts
}

function buildActive(payload: RuntimeConfigPayload): ActiveDraft {
  const r = payload.runtime
  return {
    provider: r.provider || 'auto',
    model: r.model || '',
    supervisor_provider: r.supervisor_provider ?? 'auto',
    supervisor_model: r.supervisor_model ?? '',
    student_provider: r.student_provider ?? 'auto',
    student_model: r.student_model ?? '',
    critic_provider: r.critic_provider ?? 'auto',
    critic_model: r.critic_model ?? '',
  }
}

export function ProvidersPage() {
  const providersOpen = useUiStore((s) => s.providersOpen)
  const closeProviders = useUiStore((s) => s.closeProviders)
  const lang = useSettingsStore((s) => s.language)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const setRuntimeConfig = useSettingsStore((s) => s.setRuntimeConfig)

  const [payload, setPayload] = useState<RuntimeConfigPayload | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  const [active, setActive] = useState<ActiveDraft | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [newModel, setNewModel] = useState('')
  const loadTokenRef = useRef(0)

  const teamCapable = payload?.runtime.supervisor_provider !== undefined

  useEffect(() => {
    if (!providersOpen) return
    const token = ++loadTokenRef.current
    setLoading(true)
    setFeedback(null)
    setSearch('')
    setNewModel('')
    void (async () => {
      try {
        const data = await fetchRuntimeConfig(apiUrl)
        if (loadTokenRef.current !== token) return
        setPayload(data)
        setDrafts(buildDrafts(data))
        setActive(buildActive(data))
        const firstEnabled = Object.entries(data.providers)
          .filter(([name]) => name !== 'auto')
          .sort((a, b) => Number(b[1].enabled) - Number(a[1].enabled))[0]
        setSelected(firstEnabled ? firstEnabled[0] : null)
      } catch (error) {
        if (loadTokenRef.current !== token) return
        setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
      } finally {
        if (loadTokenRef.current === token) setLoading(false)
      }
    })()
  }, [providersOpen, apiUrl])

  const providerEntries = useMemo(() => {
    if (!payload) return []
    return Object.entries(payload.providers).filter(([name]) => name !== 'auto')
  }, [payload])

  const isEnabled = (name: string): boolean => {
    const draft = drafts[name]
    if (draft) return draft.enabled
    return Boolean(payload?.providers[name]?.enabled)
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = providerEntries.filter(([name, settings]) =>
      !query ||
      name.toLowerCase().includes(query) ||
      (settings.display_name ?? '').toLowerCase().includes(query),
    )
    const enabled = list.filter(([name]) => isEnabled(name))
    const disabled = list.filter(([name]) => !isEnabled(name))
    return { enabled, disabled }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerEntries, search, drafts, payload])

  if (!providersOpen) return null

  const updateDraft = (name: string, patch: Partial<ProviderDraft>) => {
    setDrafts((current) => ({ ...current, [name]: { ...current[name], ...patch } }))
  }

  const updateActive = (patch: Partial<ActiveDraft>) => {
    setActive((current) => (current ? { ...current, ...patch } : current))
  }

  const handleFetchModels = async (name: string) => {
    setFetchingModels(true)
    setFeedback(null)
    try {
      const result = await fetchProviderModels(name, { refresh: true, apiUrl })
      setDrafts((current) => {
        const existing = current[name]?.models ?? []
        const merged = [...existing]
        for (const m of result.models) {
          if (!merged.includes(m)) merged.push(m)
        }
        return { ...current, [name]: { ...current[name], models: merged } }
      })
      setFeedback({ text: t('providersTestSuccess', lang, { count: result.models.length }), error: false })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTest = async (name: string) => {
    const draft = drafts[name]
    setTesting(true)
    setFeedback(null)
    try {
      const result = await testProvider(
        name,
        {
          ...(draft?.apiKey.trim() ? { api_key: draft.apiKey.trim() } : {}),
          api_base: draft?.apiBase.trim() || null,
        },
        apiUrl,
      )
      setFeedback({
        text: result.ok
          ? t('providersTestSuccess', lang, { count: result.model_count ?? 0 })
          : result.message,
        error: !result.ok,
      })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setTesting(false)
    }
  }

  const addModel = (name: string, model: string) => {
    const value = model.trim()
    if (!value) return
    setDrafts((current) => {
      const existing = current[name]?.models ?? []
      if (existing.includes(value)) return current
      return { ...current, [name]: { ...current[name], models: [...existing, value] } }
    })
    setNewModel('')
  }

  const removeModel = (name: string, model: string) => {
    setDrafts((current) => ({
      ...current,
      [name]: { ...current[name], models: (current[name]?.models ?? []).filter((m) => m !== model) },
    }))
  }

  const handleSave = async () => {
    if (!payload || !active) return
    setSaving(true)
    setFeedback(null)
    try {
      const providerUpdates: Record<string, { api_key?: string; api_base?: string | null; models?: string[]; enabled?: boolean }> = {}
      for (const [name, draft] of Object.entries(drafts)) {
        const original = payload.providers[name]
        const apiKey = draft.apiKey.trim()
        const apiBase = draft.apiBase.trim() ? draft.apiBase.trim() : null
        const modelsChanged = JSON.stringify(draft.models) !== JSON.stringify(original?.models ?? [])
        const apiBaseChanged = apiBase !== (original?.api_base ?? null)
        const enabledChanged = draft.enabled !== Boolean(original?.enabled)
        if (!apiKey && !modelsChanged && !apiBaseChanged && !enabledChanged) continue
        providerUpdates[name] = {
          ...(apiKey ? { api_key: apiKey } : {}),
          api_base: apiBase,
          models: draft.models,
          ...(enabledChanged ? { enabled: draft.enabled } : {}),
        }
      }

      const runtime: Record<string, string> = { provider: active.provider }
      // The backend rejects an empty primary model, so only send it when set.
      if (active.model.trim()) runtime.model = active.model.trim()
      if (teamCapable) {
        for (const role of TEAM_ROLES) {
          runtime[`${role}_provider`] = active[`${role}_provider`]
          // Empty role model = inherit primary (sent so the backend can clear it).
          runtime[`${role}_model`] = active[`${role}_model`].trim()
        }
      }

      const result = await saveProvidersConfig(
        { runtime: runtime as never, providers: providerUpdates },
        apiUrl,
      )
      setRuntimeConfig(result)
      setPayload(result)
      setDrafts(buildDrafts(result))
      setActive(buildActive(result))
      setFeedback({ text: t('providersSaved', lang), error: false })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setSaving(false)
    }
  }

  const selectedSettings = selected ? payload?.providers[selected] : undefined
  const selectedDraft = selected ? drafts[selected] : undefined
  const modelOptionsFor = (provider: string): string[] =>
    drafts[provider]?.models ?? payload?.providers[provider]?.models ?? []

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('providersTitle', lang)}</h2>
        <div className="flex items-center gap-3">
          {feedback && (
            <span className={cn('text-xs', feedback.error ? 'text-red-400' : 'text-[var(--color-text-muted)]')}>
              {feedback.text}
            </span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className={cn(
              'px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium transition-colors',
              saving || loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[var(--color-accent)]/80',
            )}
          >
            {saving ? `${t('save', lang)}...` : t('save', lang)}
          </button>
          <button
            onClick={closeProviders}
            aria-label={t('cancel', lang)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left rail: searchable, grouped provider list */}
        <div className="w-72 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
          <div className="p-3 border-b border-[var(--color-border)]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('providersSearchPlaceholder', lang)}
              className="w-full h-9 bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            <ProviderGroup
              title={t('providersGroupEnabled', lang)}
              entries={filtered.enabled}
              selected={selected}
              onSelect={setSelected}
            />
            <ProviderGroup
              title={t('providersGroupDisabled', lang)}
              entries={filtered.disabled}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </div>

        {/* Right: provider detail + active model bindings */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {!selected || !selectedSettings || !selectedDraft ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t('providersEmptyDetail', lang)}</p>
          ) : (
            <div className="max-w-2xl space-y-5">
              <div className="flex items-center gap-3">
                <ProviderIcon provider={selected} displayName={selectedSettings.display_name} size={32} />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {selectedSettings.display_name}
                  </h3>
                  {providerDescription(selected, lang) && (
                    <p className="text-[11px] text-[var(--color-text-muted)]">{providerDescription(selected, lang)}</p>
                  )}
                </div>
                {providerDocsUrl(selected) && (
                  <a
                    href={providerDocsUrl(selected) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[var(--color-accent)] hover:underline"
                  >
                    {t('providersDocs', lang)}
                  </a>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[11px] text-[var(--color-text-muted)]">{t('providersEnableToggle', lang)}</span>
                  <Switch
                    checked={selectedDraft.enabled}
                    onChange={(value) => updateDraft(selected, { enabled: value })}
                    label={selectedDraft.enabled ? t('providersEnableOff', lang) : t('providersEnableOn', lang)}
                  />
                </div>
              </div>

              {selectedSettings.is_oauth ? (
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {t('providersOauthNote', lang, { provider: selectedSettings.display_name })}
                </p>
              ) : (
                <>
                  <div>
                    <FieldLabel text={t('providersApiKey', lang)} />
                    <input
                      type="password"
                      value={selectedDraft.apiKey}
                      onChange={(e) => updateDraft(selected, { apiKey: e.target.value })}
                      placeholder={
                        selectedSettings.api_key_configured
                          ? t('providersApiKeyKeep', lang)
                          : t('providersApiKeyPlaceholder', lang)
                      }
                      className={inputClass}
                    />
                    {selectedSettings.api_key_preview && (
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                        {t('providersApiKeySaved', lang, { preview: selectedSettings.api_key_preview })}
                      </p>
                    )}
                  </div>

                  <div>
                    <FieldLabel text={t('providersApiBase', lang)} />
                    <input
                      value={selectedDraft.apiBase}
                      onChange={(e) => updateDraft(selected, { apiBase: e.target.value })}
                      placeholder={
                        selectedSettings.default_api_base
                          ? t('providersApiBaseDefault', lang, { apiBase: selectedSettings.default_api_base })
                          : t('providersApiBaseProviderDefault', lang)
                      }
                      className={inputClass}
                    />
                  </div>
                </>
              )}

              {/* Curated model list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel text={t('providersModels', lang)} className="mb-0" />
                  <div className="flex items-center gap-2">
                    {!selectedSettings.is_oauth && (
                      <SmallButton disabled={testing} onClick={() => void handleTest(selected)}>
                        {testing ? t('providersTesting', lang) : t('providersTest', lang)}
                      </SmallButton>
                    )}
                    <SmallButton disabled={fetchingModels} onClick={() => void handleFetchModels(selected)}>
                      {fetchingModels ? t('providersFetching', lang) : t('providersFetchModels', lang)}
                    </SmallButton>
                  </div>
                </div>

                {selectedDraft.models.length === 0 ? (
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-2">{t('providersNoModels', lang)}</p>
                ) : (
                  <ul className="space-y-1 mb-2">
                    {selectedDraft.models.map((model) => (
                      <li
                        key={model}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5"
                      >
                        <span className="text-sm text-[var(--color-text-primary)] font-mono truncate">{model}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {active?.provider === selected && active?.model === model ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                              {t('providersDefaultBadge', lang)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateActive({ provider: selected, model })}
                              className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                            >
                              {t('providersSetDefault', lang)}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeModel(selected, model)}
                            className="text-[11px] text-[var(--color-text-muted)] hover:text-red-400"
                          >
                            {t('providersRemove', lang)}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2">
                  <input
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addModel(selected, newModel)
                      }
                    }}
                    placeholder={t('providersModelPlaceholder', lang)}
                    className={cn(inputClass, 'h-9')}
                  />
                  <SmallButton onClick={() => addModel(selected, newModel)}>{t('providersAddModel', lang)}</SmallButton>
                </div>
              </div>
            </div>
          )}

          {/* Active model bindings */}
          {active && (
            <div className="max-w-2xl border-t border-[var(--color-border)] pt-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('providersActiveModels', lang)}</h3>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('providersRoleHint', lang)}</p>
              </div>

              <ModelBinding
                label={t('providersPrimaryModel', lang)}
                providerValue={active.provider}
                modelValue={active.model}
                providerEntries={providerEntries}
                modelOptions={modelOptionsFor(active.provider)}
                includeAuto
                onProviderChange={(provider) => updateActive({ provider })}
                onModelChange={(model) => updateActive({ model })}
                lang={lang}
              />

              {teamCapable ? (
                TEAM_ROLES.map((role) => (
                  <ModelBinding
                    key={role}
                    label={t(ROLE_LABEL_KEYS[role], lang)}
                    providerValue={active[`${role}_provider`]}
                    modelValue={active[`${role}_model`]}
                    providerEntries={providerEntries}
                    modelOptions={modelOptionsFor(active[`${role}_provider`])}
                    includeAuto
                    autoLabel={t('providersAutoDetect', lang)}
                    modelPlaceholder={t('providersRoleInherit', lang)}
                    onProviderChange={(provider) => updateActive({ [`${role}_provider`]: provider } as Partial<ActiveDraft>)}
                    onModelChange={(model) => updateActive({ [`${role}_model`]: model } as Partial<ActiveDraft>)}
                    lang={lang}
                  />
                ))
              ) : (
                <p className="text-[11px] text-[var(--color-text-muted)]">{t('providersTeamUnavailable', lang)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderGroup({
  title,
  entries,
  selected,
  onSelect,
}: {
  title: string
  entries: Array<[string, RuntimeConfigPayload['providers'][string]]>
  selected: string | null
  onSelect: (name: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <div>
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {title} ({entries.length})
      </p>
      <ul>
        {entries.map(([name, settings]) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onSelect(name)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                selected === name ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-hover)]/60',
              )}
            >
              <ProviderIcon provider={name} displayName={settings.display_name} size={22} />
              <span className="text-sm text-[var(--color-text-primary)] truncate flex-1">{settings.display_name}</span>
              {settings.configured && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ModelBinding({
  label,
  providerValue,
  modelValue,
  providerEntries,
  modelOptions,
  includeAuto,
  autoLabel,
  modelPlaceholder,
  onProviderChange,
  onModelChange,
  lang,
}: {
  label: string
  providerValue: string
  modelValue: string
  providerEntries: Array<[string, RuntimeConfigPayload['providers'][string]]>
  modelOptions: string[]
  includeAuto?: boolean
  autoLabel?: string
  modelPlaceholder?: string
  onProviderChange: (provider: string) => void
  onModelChange: (model: string) => void
  lang: Parameters<typeof t>[1]
}) {
  const listId = `models-${label.replace(/\s+/g, '-')}`
  return (
    <div className="flex items-end gap-3">
      <div className="w-44 shrink-0">
        <FieldLabel text={label} />
        <select value={providerValue} onChange={(e) => onProviderChange(e.target.value)} className={inputClass}>
          {includeAuto && <option value="auto">{autoLabel ?? t('providersAutoDetect', lang)}</option>}
          {providerEntries.map(([name, settings]) => (
            <option key={name} value={name}>
              {settings.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <input
          value={modelValue}
          onChange={(e) => onModelChange(e.target.value)}
          list={listId}
          placeholder={modelPlaceholder}
          className={inputClass}
        />
        <datalist id={listId}>
          {modelOptions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

function FieldLabel({ text, className }: { text: string; className?: string }) {
  return <label className={cn('block text-sm text-[var(--color-text-secondary)] mb-1.5', className)}>{text}</label>
}

function SmallButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs rounded-lg border transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)]'
          : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10',
      )}
    >
      {children}
    </button>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

const inputClass =
  'w-full h-10 bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'
