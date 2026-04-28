import { useSettingsStore } from '@/stores/settingsStore'

export type RuntimeProviderName = 'anthropic' | 'openai' | 'openrouter' | 'custom' | 'ollama'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'adaptive' | null

export interface RuntimeProviderSettings {
  api_key_configured: boolean
  api_key_preview: string | null
  api_base: string | null
}

export interface RuntimeConfigPayload {
  projects_root: string
  config_path: string
  persisted: boolean
  runtime: {
    workspace: string
    provider: string
    model: string
    reasoning_effort: ReasoningEffort
    max_tool_iterations: number
    restrict_to_workspace: boolean
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
  projects_root: string
  runtime: {
    workspace: string
    provider: string
    model: string
    reasoning_effort: ReasoningEffort
    max_tool_iterations: number
    restrict_to_workspace: boolean
  }
  providers: Partial<Record<RuntimeProviderName, { api_key?: string; api_base?: string | null }>>
}, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig(payload, apiUrl)
}

export async function updateProjectsRoot(projectsRoot: string, apiUrl?: string): Promise<RuntimeConfigPayload> {
  return postRuntimeConfig({ projects_root: projectsRoot }, apiUrl)
}
