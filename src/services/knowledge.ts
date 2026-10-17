import { useSettingsStore } from '@/stores/settingsStore'

export type KnowledgeSourceKind = 'file' | 'archive' | 'url' | 'git' | 'dir'
export type KnowledgeSourceStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface KnowledgeSource {
  id: string
  kind: KnowledgeSourceKind
  title: string
  origin: string
  status: KnowledgeSourceStatus
  error: string
  doc_count: number
  chunk_count: number
  meta: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface KnowledgeBaseSummary {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  sources: number
  documents: number
  chunks: number
}

export interface KnowledgeBaseDetail extends Omit<KnowledgeBaseSummary, 'sources'> {
  sources: KnowledgeSource[]
}

export interface KnowledgeHit {
  kb_id: string
  kb_name: string
  source_id: string
  source_title: string
  doc_id: string
  path: string
  url: string
  start_line: number
  end_line: number
  page: number | null
  heading: string
  text: string
  score: number
  citation: string
}

export type NewKnowledgeSource =
  | { type: 'url'; url: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'dir'; path: string }

function base(): string {
  return `${useSettingsStore.getState().apiUrl}/knowledge`
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init)
  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    // Non-JSON error bodies fall through to the status-based message.
  }
  if (!resp.ok) {
    const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : null
    if (resp.status === 404 && !error) throw new Error('Knowledge bases are not supported by this engine version.')
    throw new Error(typeof error === 'string' ? error : `Request failed (${resp.status})`)
  }
  return data as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
  const data = await request<{ knowledge_bases?: KnowledgeBaseSummary[] }>(base())
  return Array.isArray(data.knowledge_bases) ? data.knowledge_bases : []
}

export function getKnowledgeBase(kbId: string): Promise<KnowledgeBaseDetail> {
  return request(`${base()}/${encodeURIComponent(kbId)}`)
}

export function createKnowledgeBase(name: string, description = ''): Promise<KnowledgeBaseDetail> {
  return request(base(), json('POST', { name, description }))
}

export function updateKnowledgeBase(
  kbId: string,
  patch: { name?: string; description?: string },
): Promise<KnowledgeBaseDetail> {
  return request(`${base()}/${encodeURIComponent(kbId)}`, json('PATCH', patch))
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  await request(`${base()}/${encodeURIComponent(kbId)}`, { method: 'DELETE' })
}

export async function uploadKnowledgeFiles(kbId: string, files: File[]): Promise<KnowledgeSource[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  const data = await request<{ sources: KnowledgeSource[] }>(
    `${base()}/${encodeURIComponent(kbId)}/sources`,
    { method: 'POST', body: form },
  )
  return data.sources ?? []
}

export async function addKnowledgeSource(kbId: string, source: NewKnowledgeSource): Promise<KnowledgeSource[]> {
  const data = await request<{ sources: KnowledgeSource[] }>(
    `${base()}/${encodeURIComponent(kbId)}/sources`,
    json('POST', source),
  )
  return data.sources ?? []
}

export async function deleteKnowledgeSource(kbId: string, sourceId: string): Promise<void> {
  await request(`${base()}/${encodeURIComponent(kbId)}/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' })
}

export function refreshKnowledgeSource(kbId: string, sourceId: string): Promise<KnowledgeSource> {
  return request(
    `${base()}/${encodeURIComponent(kbId)}/sources/${encodeURIComponent(sourceId)}/refresh`,
    { method: 'POST' },
  )
}

export async function searchKnowledgeBase(kbId: string, query: string, topK = 8): Promise<KnowledgeHit[]> {
  const qs = new URLSearchParams({ q: query, top_k: String(topK) })
  const data = await request<{ hits?: KnowledgeHit[] }>(`${base()}/${encodeURIComponent(kbId)}/search?${qs}`)
  return Array.isArray(data.hits) ? data.hits : []
}

function projectUrl(projectId: string): string {
  return `${useSettingsStore.getState().apiUrl}/projects/${encodeURIComponent(projectId)}/knowledge`
}

export async function fetchProjectKnowledge(projectId: string): Promise<string[]> {
  const data = await request<{ knowledge_bases?: string[] }>(projectUrl(projectId))
  return Array.isArray(data.knowledge_bases) ? data.knowledge_bases : []
}

export async function saveProjectKnowledge(projectId: string, kbIds: string[]): Promise<string[]> {
  const data = await request<{ knowledge_bases?: string[] }>(
    projectUrl(projectId),
    json('PUT', { knowledge_bases: kbIds }),
  )
  return Array.isArray(data.knowledge_bases) ? data.knowledge_bases : []
}
