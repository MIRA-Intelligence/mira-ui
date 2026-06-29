import { useSettingsStore } from '@/stores/settingsStore'

export type RuntimeProviderName = string
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'adaptive' | null
export type RuntimeSetupCode = 'missing_runtime' | 'unknown_provider' | 'missing_api_base' | 'missing_api_key'

export interface RuntimeProviderSettings {
  api_key_configured: boolean
  api_key_preview: string | null
  api_base: string | null
  models: string[]
  configured: boolean
  display_name: string
  api_key_required: boolean
  api_base_required: boolean
  default_api_base: string | null
  is_oauth: boolean
  is_local: boolean
}

// ``team`` profile roles bindable to a provider + model on the providers page.
export type TeamRole = 'supervisor' | 'student' | 'critic'
export const TEAM_ROLES: TeamRole[] = ['supervisor', 'student', 'critic']

export interface RuntimeRoleBindings {
  supervisor_provider: string
  supervisor_model: string | null
  student_provider: string
  student_model: string | null
  critic_provider: string
  critic_model: string | null
}

export interface ProviderModelsResult {
  provider: string
  api_base: string | null
  models: string[]
  cached: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  model_count?: number
}

export interface RuntimeConfigPayload {
  projects_root: string
  config_path: string
  persisted: boolean
  project_location?: {
    mode: 'user_selectable' | 'managed'
    custom_dir_allowed: boolean
    default_parent_dir: string
    workspace_file: string
  }
  runtime: {
    workspace: string
    workspace_resolved?: string
    provider: string
    model: string
    reasoning_effort: ReasoningEffort
    temperature: number | null
    max_tool_iterations: number
    restrict_to_workspace: boolean
    setup_required?: boolean
    setup_message?: string | null
    setup_code?: RuntimeSetupCode | null
    setup_subject?: string | null
    // Present only when connected to a team-profile-capable engine.
    supervisor_provider?: string
    supervisor_model?: string | null
    student_provider?: string
    student_model?: string | null
    critic_provider?: string
    critic_model?: string | null
  }
  providers: Record<string, RuntimeProviderSettings>
}

function resolveApiUrl(apiUrl?: string): string {
  return apiUrl ?? useSettingsStore.getState().apiUrl
}

async function readRuntimeConfigError(resp: Response, fallback: string): Promise<string> {
  let errorMessage = ''
  try {
    const data = await resp.json()
    errorMessage = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
  } catch {
    errorMessage = await resp.text()
  }
  return errorMessage || fallback
}

async function postRuntimeConfig(body: unknown, apiUrl?: string): Promise<RuntimeConfigPayload> {
  const resp = await fetch(`${resolveApiUrl(apiUrl)}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    throw new Error(await readRuntimeConfigError(resp, 'Failed to save runtime config'))
  }
  return await resp.json() as RuntimeConfigPayload
}

export async function fetchRuntimeConfig(apiUrl?: string): Promise<RuntimeConfigPayload> {
  const resp = await fetch(`${resolveApiUrl(apiUrl)}/config`)
  if (!resp.ok) {
    throw new Error(await resp.text() || 'Failed to fetch runtime config')
  }
  return await resp.json() as RuntimeConfigPayload
}

export async function saveRuntimeConfig(payload: {
  projects_root?: string
  runtime: {
    workspace?: string
    provider: string
    model: string
    reasoning_effort: ReasoningEffort
    temperature: number | null
    max_tool_iterations: number
    restrict_to_workspace: boolean
  }
  providers: Partial<Record<string, { api_key?: string; api_base?: string | null }>>
}, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig(payload, apiUrl)
}

// Persist provider credentials, curated model lists, and team-role bindings
// owned by the Providers page. Only the fields present are written by the
// backend (which diffs against the live config), so callers send just what
// changed.
export async function saveProvidersConfig(payload: {
  runtime?: Partial<{
    provider: string
    model: string
  } & RuntimeRoleBindings>
  providers?: Partial<Record<string, { api_key?: string; api_base?: string | null; models?: string[] }>>
}, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig(payload, apiUrl)
}

export async function fetchProviderModels(
  provider: string,
  options?: { refresh?: boolean; apiUrl?: string },
): Promise<ProviderModelsResult> {
  const base = resolveApiUrl(options?.apiUrl)
  const query = options?.refresh ? '?refresh=1' : ''
  const resp = await fetch(`${base}/providers/${encodeURIComponent(provider)}/models${query}`)
  if (!resp.ok) {
    throw new Error(await readRuntimeConfigError(resp, 'Failed to fetch provider models'))
  }
  const data = await resp.json() as Partial<ProviderModelsResult>
  return {
    provider: data.provider ?? provider,
    api_base: data.api_base ?? null,
    models: Array.isArray(data.models) ? data.models : [],
    cached: Boolean(data.cached),
  }
}

export async function testProvider(
  provider: string,
  credentials?: { api_key?: string; api_base?: string | null },
  apiUrl?: string,
): Promise<ProviderTestResult> {
  const resp = await fetch(`${resolveApiUrl(apiUrl)}/providers/${encodeURIComponent(provider)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials ?? {}),
  })
  if (!resp.ok) {
    throw new Error(await readRuntimeConfigError(resp, 'Failed to test provider'))
  }
  const data = await resp.json() as Partial<ProviderTestResult>
  return {
    ok: Boolean(data.ok),
    message: typeof data.message === 'string' ? data.message : '',
    model_count: typeof data.model_count === 'number' ? data.model_count : undefined,
  }
}

export async function updateProjectsRoot(projectsRoot: string, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig({ projects_root: projectsRoot }, apiUrl)
}
