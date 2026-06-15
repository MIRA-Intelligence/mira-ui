import { useSettingsStore } from '@/stores/settingsStore'

export type RuntimeProviderName = string
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'adaptive' | null
export type RuntimeSetupCode = 'missing_runtime' | 'unknown_provider' | 'missing_api_base' | 'missing_api_key'

export interface RuntimeProviderSettings {
  api_key_configured: boolean
  api_key_preview: string | null
  api_base: string | null
  display_name: string
  api_key_required: boolean
  api_base_required: boolean
  default_api_base: string | null
  is_oauth: boolean
  is_local: boolean
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
    temperature: number
    max_tool_iterations: number
    restrict_to_workspace: boolean
    setup_required?: boolean
    setup_message?: string | null
    setup_code?: RuntimeSetupCode | null
    setup_subject?: string | null
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
    temperature: number
    max_tool_iterations: number
    restrict_to_workspace: boolean
  }
  providers: Partial<Record<string, { api_key?: string; api_base?: string | null }>>
}, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig(payload, apiUrl)
}

export async function updateProjectsRoot(projectsRoot: string, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig({ projects_root: projectsRoot }, apiUrl)
}
