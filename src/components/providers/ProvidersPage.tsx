import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  fetchProviderModels,
  fetchRuntimeConfig,
  saveProvidersConfig,
  testProvider,
  TEAM_ROLES,
  type ModelParamRule,
  type ModelParamValue,
  type ProviderUpdate,
  type ReasoningEffort,
  type RuntimeConfigPayload,
  type RuntimeProviderSettings,
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
  // Display name; only editable for custom providers.
  name: string
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

// Sentinel "provider" id selecting the global model-parameter-rules editor.
const MODEL_PARAMS_VIEW = '__model_params__'
// Sentinel "provider" id selecting the agent runtime settings editor.
const RUNTIME_VIEW = '__runtime__'

const REASONING_OPTIONS: Exclude<ReasoningEffort, null>[] = ['low', 'medium', 'high', 'adaptive']

// Editable form state for the agent runtime knobs (reasoning / temperature /
// tool iterations / workspace restriction). Persisted to whichever engine the
// UI is connected to, so local and remote behave identically.
interface RuntimeForm {
  reasoningEffort: ReasoningEffort
  maxToolIterations: string
  autoMaxRounds: string
  restrictToWorkspace: boolean
}

function buildRuntimeForm(payload: RuntimeConfigPayload): RuntimeForm {
  const r = payload.runtime
  return {
    reasoningEffort: r.reasoning_effort,
    maxToolIterations: String(r.max_tool_iterations),
    autoMaxRounds: String(r.auto_max_rounds),
    restrictToWorkspace: r.restrict_to_workspace,
  }
}

type ParamKind = 'number' | 'string' | 'boolean' | 'drop'
interface ParamRow {
  key: string
  kind: ParamKind
  value: string
}
interface RuleForm {
  pattern: string
  params: ParamRow[]
}

function paramValueToRow(key: string, value: ModelParamValue): ParamRow {
  if (value === null) return { key, kind: 'drop', value: '' }
  if (typeof value === 'number') return { key, kind: 'number', value: String(value) }
  if (typeof value === 'boolean') return { key, kind: 'boolean', value: value ? 'true' : 'false' }
  return { key, kind: 'string', value: String(value) }
}

function rulesToForms(rules: ModelParamRule[]): RuleForm[] {
  return rules.map((rule) => ({
    pattern: rule.pattern,
    params: Object.entries(rule.params ?? {}).map(([key, value]) => paramValueToRow(key, value)),
  }))
}

function rowToParamValue(row: ParamRow): ModelParamValue | undefined {
  switch (row.kind) {
    case 'drop':
      return null
    case 'boolean':
      return row.value === 'true'
    case 'number': {
      const n = Number(row.value)
      return row.value.trim() !== '' && Number.isFinite(n) ? n : undefined
    }
    default:
      return row.value
  }
}

// Convert the editable form back to the wire shape, dropping incomplete rows
// (blank pattern / blank param name / unparseable number).
function formsToRules(forms: RuleForm[]): ModelParamRule[] {
  const rules: ModelParamRule[] = []
  for (const form of forms) {
    const pattern = form.pattern.trim()
    if (!pattern) continue
    const params: Record<string, ModelParamValue> = {}
    for (const row of form.params) {
      const key = row.key.trim()
      if (!key) continue
      const value = rowToParamValue(row)
      if (value === undefined) continue
      params[key] = value
    }
    rules.push({ pattern, params })
  }
  return rules
}

const ROLE_DESC_KEYS: Record<TeamRole, I18nKey> = {
  supervisor: 'roleSupervisorDesc',
  student: 'roleStudentDesc',
  critic: 'roleCriticDesc',
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
      name: settings.display_name,
    }
  }
  return drafts
}

function isCustomProvider(name: string, settings: RuntimeProviderSettings | undefined): boolean {
  return settings?.is_custom ?? name === 'custom'
}

// Ids of additional custom providers must match the engine's custom_<suffix> pattern.
function newCustomProviderId(taken: Set<string>): string {
  for (;;) {
    const id = `custom_${Math.random().toString(36).slice(2, 10)}`
    if (/^custom_[a-z0-9]{1,32}$/.test(id) && !taken.has(id)) return id
  }
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase()
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
  const isMacDesktop = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
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
  // Models returned by the most recent "Fetch from provider", shown in a side
  // panel so the user can pick which ones to add to the curated list.
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  // Model id whose role-assignment dropdown is currently open (null = closed).
  const [roleMenu, setRoleMenu] = useState<string | null>(null)
  // Editable form state for the global model-parameter rules.
  const [ruleForms, setRuleForms] = useState<RuleForm[]>([])
  // Editable form state for the agent runtime knobs.
  const [runtimeForm, setRuntimeForm] = useState<RuntimeForm | null>(null)
  // Custom providers added on this page and not saved yet, and saved ones
  // marked for deletion on the next save.
  const [newProviders, setNewProviders] = useState<Record<string, RuntimeProviderSettings>>({})
  const [deletedProviders, setDeletedProviders] = useState<string[]>([])
  const loadTokenRef = useRef(0)

  const teamCapable = payload?.runtime.supervisor_provider !== undefined

  useEffect(() => {
    if (!providersOpen) return
    const token = ++loadTokenRef.current
    setLoading(true)
    setFeedback(null)
    setSearch('')
    setNewModel('')
    setFetchedModels([])
    setRoleMenu(null)
    void (async () => {
      try {
        const data = await fetchRuntimeConfig(apiUrl)
        if (loadTokenRef.current !== token) return
        setPayload(data)
        setDrafts(buildDrafts(data))
        setNewProviders({})
        setDeletedProviders([])
        setActive(buildActive(data))
        setRuleForms(rulesToForms(data.model_params ?? []))
        setRuntimeForm(buildRuntimeForm(data))
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

  // Auto-dismiss the feedback toast (errors linger a little longer).
  useEffect(() => {
    if (!feedback) return
    const id = setTimeout(() => setFeedback(null), feedback.error ? 6000 : 4000)
    return () => clearTimeout(id)
  }, [feedback])

  const allSettings = useMemo<Record<string, RuntimeProviderSettings>>(
    () => ({ ...(payload?.providers ?? {}), ...newProviders }),
    [payload, newProviders],
  )

  // Engines that report ``is_custom`` support several, renamable custom providers.
  const multiCustom = useMemo(
    () => Object.values(payload?.providers ?? {}).some((settings) => settings.is_custom !== undefined),
    [payload],
  )

  const labelFor = (name: string): string => {
    const settings = allSettings[name]
    const draftName = drafts[name]?.name.trim()
    if (multiCustom && isCustomProvider(name, settings) && draftName) return draftName
    return settings?.display_name || name
  }

  // Provider list with live (draft) names; unsaved custom providers follow the
  // saved ones so all custom providers stay together.
  const providerEntries = useMemo(() => {
    if (!payload) return []
    const saved = Object.entries(payload.providers)
      .filter(([name]) => name !== 'auto' && !deletedProviders.includes(name))
    const lastCustom = saved.reduce((last, [name, settings], index) => (isCustomProvider(name, settings) ? index : last), -1)
    const entries = [...saved]
    entries.splice(lastCustom + 1, 0, ...Object.entries(newProviders))
    return entries.map(([name, settings]): [string, RuntimeProviderSettings] => [
      name,
      { ...settings, display_name: labelFor(name) },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, newProviders, deletedProviders, drafts, multiCustom])

  const isEnabled = (name: string): boolean => {
    const draft = drafts[name]
    if (draft) return draft.enabled
    return Boolean(allSettings[name]?.enabled)
  }

  // Provider names must be unique: a custom provider needs a name that no
  // other provider (built-in or custom) uses.
  const nameErrorFor = (name: string): string | null => {
    if (!multiCustom || !isCustomProvider(name, allSettings[name])) return null
    const label = normalizedName(drafts[name]?.name ?? '')
    if (!label) return t('providersCustomNameRequired', lang)
    const other = providerEntries.find(([other, settings]) => other !== name && normalizedName(settings.display_name) === label)
    return other ? t('providersCustomNameDuplicate', lang, { name: other[1].display_name }) : null
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

  // Switching provider resets the fetched-models panel and any open role menu.
  // Done here rather than in an effect on ``selected``: an effect flushed late
  // could close a role menu the user opened right after the switch.
  const selectProvider = (name: string | null) => {
    setSelected(name)
    setFetchedModels([])
    setRoleMenu(null)
  }

  const updateDraft = (name: string, patch: Partial<ProviderDraft>) => {
    setDrafts((current) => ({ ...current, [name]: { ...current[name], ...patch } }))
  }

  const addCustomProvider = () => {
    const custom = payload?.providers.custom
    if (!custom) return
    // A new provider is the user's own, even when the team manages "custom".
    const { managed_by: _managedBy, ...base } = custom
    const id = newCustomProviderId(new Set(Object.keys(allSettings)))
    const labels = new Set(providerEntries.map(([, settings]) => normalizedName(settings.display_name)))
    let index = 2
    while (labels.has(normalizedName(`Custom ${index}`))) index += 1
    const name = `Custom ${index}`
    setNewProviders((current) => ({
      ...current,
      [id]: {
        ...base,
        api_key_configured: false,
        api_key_preview: null,
        api_base: null,
        models: [],
        configured: false,
        enabled: true,
        display_name: name,
        is_custom: true,
      },
    }))
    setDrafts((current) => ({ ...current, [id]: { apiKey: '', apiBase: '', models: [], enabled: true, name } }))
    selectProvider(id)
  }

  const deleteCustomProvider = (id: string) => {
    if (newProviders[id]) {
      setNewProviders(({ [id]: _removed, ...rest }) => rest)
    } else {
      setDeletedProviders((current) => [...current, id])
    }
    setDrafts(({ [id]: _removed, ...rest }) => rest)
    // Bindings must not point at a provider that no longer exists.
    setActive((cur) => {
      if (!cur) return cur
      const next = { ...cur }
      if (next.provider === id) next.provider = 'auto'
      for (const role of TEAM_ROLES) {
        if (next[`${role}_provider`] === id) {
          next[`${role}_provider`] = 'auto'
          next[`${role}_model`] = ''
        }
      }
      return next
    })
    const fallback = providerEntries.find(([name]) => name !== id)
    selectProvider(fallback ? fallback[0] : null)
  }

  const updateActive = (patch: Partial<ActiveDraft>) => {
    setActive((current) => (current ? { ...current, ...patch } : current))
  }

  // Switching a binding's provider must not leave a stale model from the old
  // provider selected. The global ``provider`` acts as a forced override, so a
  // mismatched pair (e.g. provider=nvidia + model=deepseek/…) would send the
  // deepseek model to the NVIDIA gateway and fail. Keep the model only when it
  // is still valid for the new provider; otherwise pick that provider's first
  // curated model.
  const changePrimaryProvider = (provider: string) => {
    setActive((cur) => {
      if (!cur) return cur
      const opts = modelOptionsFor(provider)
      const keep = provider === 'auto' || opts.length === 0 || opts.includes(cur.model)
      return { ...cur, provider, model: keep ? cur.model : opts[0] }
    })
  }

  const changeRoleProvider = (role: (typeof TEAM_ROLES)[number], provider: string) => {
    setActive((cur) => {
      if (!cur) return cur
      const opts = modelOptionsFor(provider)
      const curModel = cur[`${role}_model`]
      // 'auto' inherits the model's own provider, so an empty (inherit primary)
      // or existing value is fine. For a specific provider, an empty model would
      // inherit the primary model (possibly a different provider's) — force a
      // matching model instead.
      const nextModel =
        provider === 'auto' || (opts.length > 0 && opts.includes(curModel))
          ? curModel
          : opts.length > 0
            ? opts[0]
            : curModel
      return { ...cur, [`${role}_provider`]: provider, [`${role}_model`]: nextModel }
    })
  }

  const handleFetchModels = async (name: string) => {
    setFetchingModels(true)
    setFeedback(null)
    try {
      const result = await fetchProviderModels(name, { refresh: true, apiUrl })
      // Show the fetched models in the side panel rather than merging them into
      // the curated list directly; the user picks which ones to add.
      setFetchedModels(result.models)
      setFeedback({ text: t('providersFetchSuccess', lang, { count: result.models.length }), error: false })
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

  const addAllFetched = (name: string) => {
    setDrafts((current) => {
      const existing = current[name]?.models ?? []
      const merged = [...existing]
      for (const m of fetchedModels) {
        if (!merged.includes(m)) merged.push(m)
      }
      return { ...current, [name]: { ...current[name], models: merged } }
    })
  }

  const handleSave = async () => {
    if (!payload || !active) return
    const invalid = providerEntries.map(([name]) => [name, nameErrorFor(name)] as const).find(([, error]) => error)
    if (invalid) {
      selectProvider(invalid[0])
      setFeedback({ text: invalid[1]!, error: true })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      const nextRules = formsToRules(ruleForms)
      const rulesChanged = !payload.team?.model_params
        && JSON.stringify(nextRules) !== JSON.stringify(payload.model_params ?? [])

      const providerUpdates: Record<string, ProviderUpdate> = {}
      for (const [name, draft] of Object.entries(drafts)) {
        const isNew = Boolean(newProviders[name])
        const original = isNew ? undefined : payload.providers[name]
        if (original?.managed_by === 'team') continue
        const apiKey = draft.apiKey.trim()
        const apiBase = draft.apiBase.trim() ? draft.apiBase.trim() : null
        const modelsChanged = JSON.stringify(draft.models) !== JSON.stringify(original?.models ?? [])
        const apiBaseChanged = apiBase !== (original?.api_base ?? null)
        const enabledChanged = isNew || draft.enabled !== Boolean(original?.enabled)
        const nameChanged = multiCustom && isCustomProvider(name, allSettings[name])
          && (isNew || draft.name.trim() !== (original?.display_name ?? ''))
        if (!apiKey && !modelsChanged && !apiBaseChanged && !enabledChanged && !nameChanged) continue
        providerUpdates[name] = {
          ...(apiKey ? { api_key: apiKey } : {}),
          api_base: apiBase,
          models: draft.models,
          ...(enabledChanged ? { enabled: draft.enabled } : {}),
          ...(nameChanged ? { name: draft.name.trim() || null } : {}),
        }
      }
      for (const name of deletedProviders) providerUpdates[name] = null

      const runtime: Record<string, string | number | boolean | null> = { provider: active.provider }
      // The backend rejects an empty primary model, so only send it when set.
      if (active.model.trim()) runtime.model = active.model.trim()
      if (teamCapable) {
        for (const role of TEAM_ROLES) {
          runtime[`${role}_provider`] = active[`${role}_provider`]
          // Empty role model = inherit primary (sent so the backend can clear it).
          runtime[`${role}_model`] = active[`${role}_model`].trim()
        }
      }

      // Agent runtime knobs (reasoning / temperature / iterations / workspace
      // restriction). The backend diffs against live config, so always sending
      // the current values is a no-op when unchanged.
      if (runtimeForm) {
        const maxIter = Number(runtimeForm.maxToolIterations.trim())
        if (!Number.isInteger(maxIter) || maxIter < 1) {
          throw new Error(t('runtimeMaxIterInvalid', lang))
        }
        const maxRounds = Number(runtimeForm.autoMaxRounds.trim())
        if (!Number.isInteger(maxRounds) || maxRounds < 1) {
          throw new Error(t('runtimeMaxRoundsInvalid', lang))
        }
        runtime.reasoning_effort = runtimeForm.reasoningEffort
        runtime.max_tool_iterations = maxIter
        runtime.auto_max_rounds = maxRounds
        runtime.restrict_to_workspace = runtimeForm.restrictToWorkspace
      }

      const result = await saveProvidersConfig(
        {
          runtime: runtime as never,
          providers: providerUpdates,
          ...(rulesChanged ? { model_params: nextRules } : {}),
        },
        apiUrl,
      )
      setRuntimeConfig(result)
      setPayload(result)
      setDrafts(buildDrafts(result))
      setNewProviders({})
      setDeletedProviders([])
      setActive(buildActive(result))
      setRuntimeForm(buildRuntimeForm(result))
      // Only repopulate from the server when it actually echoes the rules back.
      // If an older engine omits ``model_params``, keep the user's entered rows
      // instead of silently clearing the editor.
      if (result.model_params !== undefined) {
        setRuleForms(rulesToForms(result.model_params))
      }
      setFeedback({ text: t('providersSaved', lang), error: false })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setSaving(false)
    }
  }

  const selectedSettings = selected ? allSettings[selected] : undefined
  const selectedDraft = selected ? drafts[selected] : undefined
  // Team server: administrators manage this provider; the user only picks models.
  const teamManaged = selectedSettings?.managed_by === 'team'
  const selectedIsCustom = selected ? isCustomProvider(selected, selectedSettings) : false
  // The engine only knows a custom provider once it is saved.
  const selectedUnsaved = selected ? Boolean(newProviders[selected]) : false
  // Additional custom providers use the plain "custom" catalog entry.
  const catalogKey = selectedIsCustom ? 'custom' : selected ?? ''
  const selectedLabel = selected ? labelFor(selected) : ''
  const selectedNameError = selected ? nameErrorFor(selected) : null
  const modelOptionsFor = (provider: string): string[] =>
    drafts[provider]?.models ?? payload?.providers[provider]?.models ?? []

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg-primary)]">
      {/* Prominent, centered feedback toast so test/fetch/save results are
          obvious instead of hidden in the corner. */}
      {feedback && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-[120] -translate-x-1/2 px-4">
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className={cn(
              'pointer-events-auto flex items-center gap-2.5 rounded-xl border px-5 py-3 text-sm font-medium shadow-xl backdrop-blur transition-opacity',
              feedback.error
                ? 'border-red-500/40 bg-red-500/15 text-red-300'
                : 'border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]',
            )}
          >
            <span aria-hidden className="text-base leading-none">{feedback.error ? '⚠' : '✓'}</span>
            <span>{feedback.text}</span>
          </button>
        </div>
      )}
      {/* This overlay covers the TopBar, which is an Electron drag region on
          macOS. Drag regions swallow clicks regardless of z-index, so the
          header must opt out or Save / Close are unclickable. On macOS the
          hiddenInset traffic lights also sit over the top-left corner. */}
      <div
        data-drag-region="no-drag"
        className={cn(
          'flex items-center justify-between py-4 pr-6 border-b border-[var(--color-border)] shrink-0',
          isMacDesktop ? 'pl-24' : 'pl-6',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('providersTitle', lang)}</h2>
          {payload?.scope === 'team' && (
            <span
              title={t('providersTeamScopeHint', lang)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-notice-border)] bg-[var(--color-notice-bg)] text-[var(--color-notice-text)]"
            >
              {t('providersTeamScope', lang)} · {t('providersTeamScopeHint', lang)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={() => selectProvider(MODEL_PARAMS_VIEW)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                selected === MODEL_PARAMS_VIEW ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-hover)]/60',
              )}
            >
              <span aria-hidden className="flex h-[22px] w-[22px] items-center justify-center text-base leading-none">⚙</span>
              <span className="text-sm text-[var(--color-text-primary)] truncate flex-1">{t('modelParamsNav', lang)}</span>
            </button>
            <button
              type="button"
              onClick={() => selectProvider(RUNTIME_VIEW)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                selected === RUNTIME_VIEW ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-hover)]/60',
              )}
            >
              <span aria-hidden className="flex h-[22px] w-[22px] items-center justify-center text-base leading-none">🎛</span>
              <span className="text-sm text-[var(--color-text-primary)] truncate flex-1">{t('runtimeNav', lang)}</span>
            </button>
            <ProviderGroup
              title={t('providersGroupEnabled', lang)}
              entries={filtered.enabled}
              selected={selected}
              onSelect={selectProvider}
              enabledGroup
              teamBadge={t('providersTeamBadge', lang)}
            />
            <ProviderGroup
              title={t('providersGroupDisabled', lang)}
              entries={filtered.disabled}
              selected={selected}
              onSelect={selectProvider}
              enabledGroup={false}
              teamBadge={t('providersTeamBadge', lang)}
            />
            {multiCustom && payload?.providers.custom && (
              <button
                type="button"
                onClick={addCustomProvider}
                className="w-full rounded-lg border border-dashed border-[var(--color-border)] px-2 py-2 text-left text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
              >
                + {t('providersAddCustom', lang)}
              </button>
            )}
          </div>
        </div>

        {/* Detail + active bindings (capped at max-w-2xl) on the left; the
            fetched-models list fills the blank space to their right. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {selected === MODEL_PARAMS_VIEW ? (
            payload?.team?.model_params ? (
              <div className="space-y-3">
                <p className="text-[11px] text-[var(--color-notice-text)]">{t('modelParamsTeamManaged', lang)}</p>
                <fieldset disabled className="opacity-70">
                  <ModelParamsEditor forms={ruleForms} setForms={setRuleForms} lang={lang} />
                </fieldset>
              </div>
            ) : (
              <ModelParamsEditor forms={ruleForms} setForms={setRuleForms} lang={lang} />
            )
          ) : selected === RUNTIME_VIEW ? (
            <RuntimeSettingsEditor form={runtimeForm} setForm={setRuntimeForm} lang={lang} />
          ) : (
          <div className="flex items-start gap-8">
          <div className="w-full max-w-2xl space-y-8">
          {!selected || !selectedSettings || !selectedDraft ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t('providersEmptyDetail', lang)}</p>
          ) : (
            <div className="max-w-2xl space-y-5">
              <div className="flex items-center gap-3">
                <ProviderIcon provider={catalogKey} displayName={selectedLabel} size={32} />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {selectedLabel}
                  </h3>
                  {providerDescription(catalogKey, lang) && (
                    <p className="text-[11px] text-[var(--color-text-muted)]">{providerDescription(catalogKey, lang)}</p>
                  )}
                </div>
                {providerDocsUrl(catalogKey) && (
                  <a
                    href={providerDocsUrl(catalogKey) ?? undefined}
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
                    disabled={teamManaged}
                  />
                </div>
              </div>

              {selectedIsCustom && multiCustom && !teamManaged && (
                <div>
                  <FieldLabel text={t('providersCustomName', lang)} />
                  <div className="flex items-center gap-3">
                    <input
                      aria-label={t('providersCustomName', lang)}
                      value={selectedDraft.name}
                      onChange={(e) => updateDraft(selected, { name: e.target.value })}
                      placeholder={t('providersCustomNamePlaceholder', lang)}
                      aria-invalid={selectedNameError ? true : undefined}
                      className={cn(inputClass, selectedNameError && 'border-red-500/60 focus:border-red-500')}
                    />
                    {selected !== 'custom' && (
                      <button
                        type="button"
                        onClick={() => deleteCustomProvider(selected)}
                        title={t('providersDeleteCustomHint', lang)}
                        className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        {t('providersDeleteCustom', lang)}
                      </button>
                    )}
                  </div>
                  {selectedNameError ? (
                    <p role="alert" className="mt-1 text-[11px] leading-relaxed text-red-400">
                      {selectedNameError}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t('providersCustomNameHint', lang)}</p>
                  )}
                </div>
              )}

              {teamManaged ? (
                <p className="rounded-lg border border-[var(--color-notice-border)] bg-[var(--color-notice-bg)] px-3 py-2 text-[11px] text-[var(--color-notice-text)]">
                  {t('providersTeamManaged', lang, { provider: selectedSettings.display_name })}
                </p>
              ) : selectedSettings.is_oauth ? (
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
                      <SmallButton disabled={testing || selectedUnsaved} title={selectedUnsaved ? t('providersSaveFirst', lang) : undefined} onClick={() => void handleTest(selected)}>
                        {testing ? t('providersTesting', lang) : t('providersTest', lang)}
                      </SmallButton>
                    )}
                    {!teamManaged && (
                      <SmallButton disabled={fetchingModels || selectedUnsaved} title={selectedUnsaved ? t('providersSaveFirst', lang) : undefined} onClick={() => void handleFetchModels(selected)}>
                        {fetchingModels ? t('providersFetching', lang) : t('providersFetchModels', lang)}
                      </SmallButton>
                    )}
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
                          {/* Badges showing the roles this model is currently bound to. */}
                          {active?.provider === selected && active?.model === model && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                              {t('providersDefaultBadge', lang)}
                            </span>
                          )}
                          {teamCapable &&
                            TEAM_ROLES.filter(
                              (role) =>
                                active?.[`${role}_provider`] === selected && active?.[`${role}_model`] === model,
                            ).map((role) => (
                              <span
                                key={role}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                              >
                                {t(ROLE_LABEL_KEYS[role], lang)}
                              </span>
                            ))}

                          {/* Split button: the main action sets the primary model,
                              the caret opens role-assignment options. */}
                          <div className="relative flex items-stretch">
                            <button
                              type="button"
                              onClick={() => updateActive({ provider: selected, model })}
                              className="rounded-l-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                            >
                              {t('providersSetDefault', lang)}
                            </button>
                            <button
                              type="button"
                              aria-label={t('providersAssignTo', lang)}
                              aria-haspopup="menu"
                              aria-expanded={roleMenu === model}
                              onClick={() => setRoleMenu((cur) => (cur === model ? null : model))}
                              className="rounded-r-md border border-l-0 border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                            >
                              ▾
                            </button>
                            {roleMenu === model && (
                              <>
                                <button
                                  type="button"
                                  aria-hidden
                                  tabIndex={-1}
                                  onClick={() => setRoleMenu(null)}
                                  className="fixed inset-0 z-10 cursor-default"
                                />
                                <div
                                  role="menu"
                                  className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-1 shadow-xl"
                                >
                                  <RoleMenuItem
                                    label={t('providersSetDefault', lang)}
                                    active={active?.provider === selected && active?.model === model}
                                    onClick={() => {
                                      updateActive({ provider: selected, model })
                                      setRoleMenu(null)
                                    }}
                                  />
                                  {teamCapable &&
                                    TEAM_ROLES.map((role) => (
                                      <RoleMenuItem
                                        key={role}
                                        label={t('providersSetAs', lang, { role: t(ROLE_LABEL_KEYS[role], lang) })}
                                        active={
                                          active?.[`${role}_provider`] === selected &&
                                          active?.[`${role}_model`] === model
                                        }
                                        onClick={() => {
                                          updateActive({
                                            [`${role}_provider`]: selected,
                                            [`${role}_model`]: model,
                                          } as Partial<ActiveDraft>)
                                          setRoleMenu(null)
                                        }}
                                      />
                                    ))}
                                </div>
                              </>
                            )}
                          </div>

                          {!teamManaged && (
                            <button
                              type="button"
                              onClick={() => removeModel(selected, model)}
                              className="text-[11px] text-[var(--color-text-muted)] hover:text-red-400"
                            >
                              {t('providersRemove', lang)}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {!teamManaged && (
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
                )}
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
                description={t('providersPrimaryModelDesc', lang)}
                providerValue={active.provider}
                modelValue={active.model}
                providerEntries={providerEntries}
                modelOptions={modelOptionsFor(active.provider)}
                includeAuto
                onProviderChange={changePrimaryProvider}
                onModelChange={(model) => updateActive({ model })}
                lang={lang}
              />

              {teamCapable ? (
                TEAM_ROLES.map((role) => (
                  <ModelBinding
                    key={role}
                    label={t(ROLE_LABEL_KEYS[role], lang)}
                    description={t(ROLE_DESC_KEYS[role], lang)}
                    providerValue={active[`${role}_provider`]}
                    modelValue={active[`${role}_model`]}
                    providerEntries={providerEntries}
                    modelOptions={modelOptionsFor(active[`${role}_provider`])}
                    includeAuto
                    autoLabel={t('providersAutoDetect', lang)}
                    modelPlaceholder={t('providersRoleInherit', lang)}
                    onProviderChange={(provider) => changeRoleProvider(role, provider)}
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

          {/* Fetched models render in the blank space to the right of the
              detail/active columns, instead of pushing content down. */}
          {selected && fetchedModels.length > 0 && (
            <div className="flex-1 min-w-0 flex max-h-[70vh] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] lg:sticky lg:top-0">
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{t('providersFetchedTitle', lang)}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">{t('providersFetchedCount', lang, { count: fetchedModels.length })}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => addAllFetched(selected)}
                    className="text-[11px] text-[var(--color-accent)] hover:underline"
                  >
                    {t('providersAddAll', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFetchedModels([])}
                    aria-label={t('cancel', lang)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-base leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {fetchedModels.map((model) => {
                  const added = (drafts[selected]?.models ?? []).includes(model)
                  return (
                    <li
                      key={model}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-bg-hover)]/60"
                    >
                      <span className="text-xs font-mono text-[var(--color-text-primary)] truncate">{model}</span>
                      {added ? (
                        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{t('providersAdded', lang)}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addModel(selected, model)}
                          className="text-[11px] text-[var(--color-accent)] hover:underline shrink-0"
                        >
                          {t('providersAddModel', lang)}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
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
  enabledGroup,
  teamBadge,
}: {
  title: string
  entries: Array<[string, RuntimeConfigPayload['providers'][string]]>
  selected: string | null
  onSelect: (name: string) => void
  teamBadge: string
  // Whether this group lists enabled providers. The green "ready" dot is only
  // meaningful for enabled providers — disabled ones (e.g. local vLLM/Ollama/
  // OVMS that report ``configured`` without a key) must not show it.
  enabledGroup: boolean
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
              {settings.managed_by === 'team' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-notice-border)] bg-[var(--color-notice-bg)] text-[var(--color-notice-text)] shrink-0">
                  {teamBadge}
                </span>
              )}
              {enabledGroup && settings.configured && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ModelBinding({
  label,
  description,
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
  description?: string
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
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
        {description && <span className="text-[11px] text-[var(--color-text-muted)]">{description}</span>}
      </div>
      <div className="flex items-end gap-3">
        <div className="w-44 shrink-0">
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
    </div>
  )
}

function RuntimeSettingsEditor({
  form,
  setForm,
  lang,
}: {
  form: RuntimeForm | null
  setForm: React.Dispatch<React.SetStateAction<RuntimeForm | null>>
  lang: Parameters<typeof t>[1]
}) {
  if (!form) {
    return <p className="text-sm text-[var(--color-text-muted)]">{t('providersEmptyDetail', lang)}</p>
  }
  const update = (patch: Partial<RuntimeForm>) => setForm((cur) => (cur ? { ...cur, ...patch } : cur))

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('runtimeTitle', lang)}</h3>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{t('runtimeHint', lang)}</p>
      </div>

      <div>
        <FieldLabel text={t('runtimeReasoning', lang)} />
        <select
          value={form.reasoningEffort ?? ''}
          onChange={(e) => update({ reasoningEffort: e.target.value ? (e.target.value as Exclude<ReasoningEffort, null>) : null })}
          className={inputClass}
        >
          <option value="">{t('runtimeReasoningDisabled', lang)}</option>
          {REASONING_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel text={t('runtimeMaxIter', lang)} />
        <input
          value={form.maxToolIterations}
          onChange={(e) => update({ maxToolIterations: e.target.value })}
          inputMode="numeric"
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel text={t('runtimeMaxRounds', lang)} />
        <input
          value={form.autoMaxRounds}
          onChange={(e) => update({ autoMaxRounds: e.target.value })}
          inputMode="numeric"
          className={inputClass}
        />
        <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('runtimeMaxRoundsHint', lang)}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <FieldLabel text={t('runtimeRestrict', lang)} className="mb-0" />
          <p className="text-[11px] text-[var(--color-text-muted)]">{t('runtimeRestrictHint', lang)}</p>
        </div>
        <Switch
          checked={form.restrictToWorkspace}
          onChange={(value) => update({ restrictToWorkspace: value })}
          label={t('runtimeRestrict', lang)}
        />
      </div>
    </div>
  )
}

function ModelParamsEditor({
  forms,
  setForms,
  lang,
}: {
  forms: RuleForm[]
  setForms: React.Dispatch<React.SetStateAction<RuleForm[]>>
  lang: Parameters<typeof t>[1]
}) {
  const updateRule = (index: number, patch: Partial<RuleForm>) => {
    setForms((cur) => cur.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }
  const updateParam = (ruleIndex: number, paramIndex: number, patch: Partial<ParamRow>) => {
    setForms((cur) =>
      cur.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, params: rule.params.map((p, j) => (j === paramIndex ? { ...p, ...patch } : p)) }
          : rule,
      ),
    )
  }
  const addRule = () => setForms((cur) => [...cur, { pattern: '', params: [{ key: '', kind: 'number', value: '' }] }])
  const removeRule = (index: number) => setForms((cur) => cur.filter((_, i) => i !== index))
  const addParam = (ruleIndex: number) =>
    updateRule(ruleIndex, { params: [...forms[ruleIndex].params, { key: '', kind: 'number', value: '' }] })
  const removeParam = (ruleIndex: number, paramIndex: number) =>
    setForms((cur) =>
      cur.map((rule, i) =>
        i === ruleIndex ? { ...rule, params: rule.params.filter((_, j) => j !== paramIndex) } : rule,
      ),
    )

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('modelParamsTitle', lang)}</h3>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{t('modelParamsHint', lang)}</p>
      </div>

      {forms.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t('modelParamsEmpty', lang)}</p>
      ) : (
        <div className="space-y-4">
          {forms.map((rule, ruleIndex) => (
            <div
              key={ruleIndex}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <FieldLabel text={t('modelParamsPattern', lang)} />
                  <input
                    value={rule.pattern}
                    onChange={(e) => updateRule(ruleIndex, { pattern: e.target.value })}
                    placeholder={t('modelParamsPatternPlaceholder', lang)}
                    className={cn(inputClass, 'font-mono')}
                  />
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{t('modelParamsPatternHint', lang)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(ruleIndex)}
                  className="mt-7 text-[11px] text-[var(--color-text-muted)] hover:text-red-400 shrink-0"
                >
                  {t('modelParamsRemoveRule', lang)}
                </button>
              </div>

              <div>
                <FieldLabel text={t('modelParamsParams', lang)} />
                <div className="space-y-2">
                  {rule.params.map((param, paramIndex) => (
                    <div key={paramIndex} className="flex items-center gap-2">
                      <input
                        value={param.key}
                        onChange={(e) => updateParam(ruleIndex, paramIndex, { key: e.target.value })}
                        placeholder={t('modelParamsParamNamePlaceholder', lang)}
                        className={cn(inputClass, 'h-9 flex-1 font-mono')}
                      />
                      <select
                        value={param.kind}
                        onChange={(e) => updateParam(ruleIndex, paramIndex, { kind: e.target.value as ParamKind })}
                        className={cn(inputClass, 'h-9 w-32 shrink-0')}
                      >
                        <option value="number">{t('modelParamsKindNumber', lang)}</option>
                        <option value="string">{t('modelParamsKindString', lang)}</option>
                        <option value="boolean">{t('modelParamsKindBoolean', lang)}</option>
                        <option value="drop">{t('modelParamsKindDrop', lang)}</option>
                      </select>
                      {param.kind === 'drop' ? (
                        <span className="flex-1 text-[11px] text-[var(--color-text-muted)] px-1">{t('modelParamsDropNote', lang)}</span>
                      ) : param.kind === 'boolean' ? (
                        <select
                          value={param.value === 'true' ? 'true' : 'false'}
                          onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                          className={cn(inputClass, 'h-9 flex-1')}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          value={param.value}
                          onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                          inputMode={param.kind === 'number' ? 'decimal' : 'text'}
                          placeholder={t('modelParamsValue', lang)}
                          className={cn(inputClass, 'h-9 flex-1 font-mono')}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeParam(ruleIndex, paramIndex)}
                        aria-label={t('providersRemove', lang)}
                        className="text-[var(--color-text-muted)] hover:text-red-400 text-sm leading-none px-1 shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addParam(ruleIndex)}
                  className="mt-2 text-[11px] text-[var(--color-accent)] hover:underline"
                >
                  + {t('modelParamsAddParam', lang)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SmallButton onClick={addRule}>+ {t('modelParamsAddRule', lang)}</SmallButton>
    </div>
  )
}

function FieldLabel({ text, className }: { text: string; className?: string }) {
  return <label className={cn('block text-sm text-[var(--color-text-secondary)] mb-1.5', className)}>{text}</label>
}

function RoleMenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[11px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]/60"
    >
      <span>{label}</span>
      {active && <span className="text-[var(--color-accent)]">✓</span>}
    </button>
  )
}

function SmallButton(
  { children, disabled, title, onClick }: { children: React.ReactNode; disabled?: boolean; title?: string; onClick: () => void },
) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
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

function Switch({ checked, onChange, label, disabled = false }: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
        disabled && 'opacity-50 cursor-not-allowed',
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
