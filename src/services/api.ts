import { useSettingsStore } from '@/stores/settingsStore'
import { createUuid } from '@/lib/uuid'
import { withEngineAuth } from './engineAuth'
import type {
  ActiveTurn,
  AgentProfile,
  ContractVersion,
  LogEntry,
  SkillPlugin,
  SkillLoadEvent,
  SkillPluginScope,
  SkillPluginTargetType,
  TaskPlanContract,
  TaskPlan,
  ProjectFileEntry,
  ProjectFileInfo,
} from '@/types'

function getApiUrl(): string {
  return useSettingsStore.getState().apiUrl
}

export async function fetchPlan(sessionId?: string): Promise<TaskPlan | null> {
  try {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    const resp = await fetch(`${getApiUrl()}/plan${qs}`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data || data.error) return null
    return data as TaskPlan
  } catch {
    return null
  }
}

export async function fetchPlanContract(sessionId?: string): Promise<TaskPlanContract | null> {
  if (!sessionId) return null
  try {
    const qs = `?session_id=${encodeURIComponent(sessionId)}`
    const resp = await fetch(`${getApiUrl()}/plan/contract${qs}`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data || data.error) return null
    return data as TaskPlanContract
  } catch {
    return null
  }
}

export async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/status`)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

export interface FeedbackPayload {
  id: string
  clientId: string
  clientHandle: string
  type: 'bug' | 'feature' | 'question' | 'other'
  severity: 'blocker' | 'critical' | 'normal' | 'minor' | null
  title: string
  body: string
  contact: { kind: 'wechat' | 'phone' | 'email'; value: string } | null
  appVersion: string
  os: string
  route: string
  locale: string
  createdAt: string
}

export interface FeedbackRelayConfig {
  configured: boolean
  inviteUrl: string | null
}

function normalizeFeedbackConfig(data: unknown): FeedbackRelayConfig {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const invite = record.invite_url ?? record.inviteUrl
  return {
    configured: record.configured === true,
    inviteUrl: typeof invite === 'string' && invite.trim().length > 0 ? invite : null,
  }
}

export async function fetchFeedbackConfig(): Promise<FeedbackRelayConfig> {
  try {
    const resp = await fetch(`${getApiUrl()}/feedback/config`)
    if (!resp.ok) return { configured: false, inviteUrl: null }
    return normalizeFeedbackConfig(await resp.json())
  } catch {
    return { configured: false, inviteUrl: null }
  }
}

export async function submitFeedbackReport(payload: FeedbackPayload): Promise<{ inviteUrl: string | null }> {
  const resp = await fetch(`${getApiUrl()}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    throw new Error(typeof record.error === 'string' && record.error ? record.error : `feedback request failed (${resp.status})`)
  }
  const config = normalizeFeedbackConfig(data)
  return { inviteUrl: config.inviteUrl }
}

export interface RemoteProject {
  id: string
  display_name?: string
  project_dir?: string
  title?: string
  status?: string
  core_question?: string
  started_at?: string
  run_mode?: 'manual' | 'auto'
  agent_profile?: AgentProfile
  contract_version?: ContractVersion
  has_plan: boolean
  has_meta?: boolean
}

export interface OrganizationFolder {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface RemoteChat {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface OrganizationSnapshot {
  schema_version: number
  folders: OrganizationFolder[]
  chats: RemoteChat[]
  assignments: {
    chat: Record<string, string>
    project: Record<string, string>
  }
}

async function organizationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${getApiUrl()}/organization${path}`, init)
  if (!resp.ok) {
    let message = await resp.text()
    try {
      const parsed = JSON.parse(message) as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // Keep the response body as the error message.
    }
    throw new Error(message || `organization request failed (${resp.status})`)
  }
  return await resp.json() as T
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export async function fetchOrganization(): Promise<OrganizationSnapshot> {
  return organizationRequest<OrganizationSnapshot>('')
}

export async function importOrganizationChats(chats: RemoteChat[]): Promise<RemoteChat[]> {
  const result = await organizationRequest<{ chats: RemoteChat[] }>('/chats/import', jsonInit('POST', { chats }))
  return result.chats
}

export async function createOrganizationFolder(name: string): Promise<OrganizationFolder> {
  return organizationRequest<OrganizationFolder>('/folders', jsonInit('POST', { name }))
}

export async function renameOrganizationFolder(folderId: string, name: string): Promise<OrganizationFolder> {
  return organizationRequest<OrganizationFolder>(`/folders/${encodeURIComponent(folderId)}`, jsonInit('PATCH', { name }))
}

export async function deleteOrganizationFolder(folderId: string): Promise<void> {
  await organizationRequest(`/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' })
}

export async function assignOrganizationFolder(
  kind: 'chat' | 'project',
  itemId: string,
  folderId: string | null,
): Promise<void> {
  await organizationRequest(
    `/items/${kind}/${encodeURIComponent(itemId)}/folder`,
    jsonInit('PATCH', { folder_id: folderId }),
  )
}

export async function updateOrganizationChat(
  chatId: string,
  payload: { title?: string; touch?: boolean },
): Promise<RemoteChat> {
  return organizationRequest<RemoteChat>(`/chats/${encodeURIComponent(chatId)}`, jsonInit('PATCH', payload))
}

/** Remove a chat from the list; `deleteFiles` also deletes its local folder (chats/<id>). */
export async function deleteOrganizationChat(
  chatId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<void> {
  const query = options.deleteFiles ? '?delete_files=1' : ''
  await organizationRequest(`/chats/${encodeURIComponent(chatId)}${query}`, { method: 'DELETE' })
}

export class ProjectDirectoryExistsError extends Error {
  constructor(public readonly projectDir: string) {
    super(`Project directory already exists: ${projectDir}`)
    this.name = 'ProjectDirectoryExistsError'
  }
}

export async function createRemoteProject(payload: {
  projectId?: string
  displayName?: string
  projectParentDir?: string
  projectDir?: string
  allowExistingDir?: boolean
  runMode?: 'manual' | 'auto'
  agentProfile?: AgentProfile
  contractVersion?: ContractVersion
  automationPolicy?: unknown
}): Promise<RemoteProject> {
  const body: Record<string, unknown> = {}
  if (payload.projectId) body.project_id = payload.projectId
  if (payload.displayName) body.display_name = payload.displayName
  if (payload.projectParentDir) body.project_parent_dir = payload.projectParentDir
  if (payload.projectDir) body.project_dir = payload.projectDir
  if (payload.allowExistingDir === true) body.allow_existing_dir = true
  if (payload.runMode) body.run_mode = payload.runMode
  if (payload.agentProfile) body.agent_profile = payload.agentProfile
  if (payload.contractVersion) body.contract_version = payload.contractVersion
  if (payload.automationPolicy !== undefined) body.automation_policy = payload.automationPolicy

  const resp = await fetch(`${getApiUrl()}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const message = await resp.text()
    let details: { code?: string; project_dir?: string } | null = null
    try { details = JSON.parse(message) } catch { /* Older engines may return plain text. */ }
    if (resp.status === 409 && details?.code === 'project_directory_exists' && typeof details.project_dir === 'string') {
      throw new ProjectDirectoryExistsError(details.project_dir)
    }
    throw new Error(message)
  }
  return await resp.json() as RemoteProject
}

export async function fetchProjects(): Promise<RemoteProject[] | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/projects`)
    if (!resp.ok) return null
    const data = await resp.json()
    return (data?.projects as RemoteProject[]) ?? []
  } catch {
    return null
  }
}

export async function updateProjectDisplayName(sessionId: string, displayName: string): Promise<string> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/meta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  if (typeof data?.display_name === 'string' && data.display_name.trim().length > 0) {
    return data.display_name.trim()
  }
  return sessionId
}

export async function updateProjectRuntimePreferences(
  sessionId: string,
  payload: {
    runMode?: 'manual' | 'auto'
    agentProfile?: AgentProfile
    contractVersion?: ContractVersion
  },
): Promise<{ runMode?: 'manual' | 'auto'; agentProfile?: AgentProfile; contractVersion?: ContractVersion }> {
  const body: Record<string, unknown> = {}
  if (payload.runMode) body.run_mode = payload.runMode
  if (payload.agentProfile) body.agent_profile = payload.agentProfile
  if (payload.contractVersion) body.contract_version = payload.contractVersion
  if (Object.keys(body).length === 0) return {}

  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/meta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return {
    runMode: (data?.run_mode === 'manual' || data?.run_mode === 'auto') ? data.run_mode : undefined,
    agentProfile: (data?.agent_profile === 'engineer' || data?.agent_profile === 'research' || data?.agent_profile === 'team')
      ? data.agent_profile
      : undefined,
    contractVersion: (data?.contract_version === 1 || data?.contract_version === 2)
      ? data.contract_version
      : undefined,
  }
}

export async function fetchSessionHistory(sessionId: string, workflowRunId?: string): Promise<LogEntry[]> {
  try {
    const query = workflowRunId ? `?workflow_run_id=${encodeURIComponent(workflowRunId)}` : ''
    const resp = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/history${query}`)
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data?.entries) ? (data.entries as LogEntry[]) : []
  } catch {
    return []
  }
}

/** Turns still running for a session, or null when the engine cannot say (older engine, offline). */
export async function fetchActiveTurns(sessionId: string): Promise<ActiveTurn[] | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/turns`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!Array.isArray(data?.active)) return null
    return (data.active as unknown[]).flatMap((raw) => {
      const row = raw as Record<string, unknown> | null
      if (!row || typeof row.turn_id !== 'string') return []
      const runId = typeof row.workflow_run_id === 'string' && row.workflow_run_id ? row.workflow_run_id : null
      return [{ turn_id: row.turn_id, workflow_run_id: runId }]
    })
  } catch {
    return null
  }
}

export async function fetchTokenUsage(sessionId: string): Promise<unknown> {
  const response = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/usage`)
  if (!response.ok) throw new Error('Token usage unavailable')
  return response.json()
}

export async function fetchSkillHistory(sessionId: string, cursor?: number): Promise<{ events: SkillLoadEvent[]; next_cursor: number | null }> {
  const query = cursor === undefined ? '' : `?cursor=${cursor}`
  const response = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/skills${query}`)
  if (!response.ok) throw new Error(response.status === 404 ? 'unsupported' : 'unavailable')
  return response.json()
}

export interface DeleteProjectResult {
  deleted: boolean
  removed: boolean
  reason?: string
}

function readErrorMessage(data: unknown, fallback: string): string {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const error = record.error ?? record.reason
  return typeof error === 'string' && error.trim().length > 0 ? error.trim() : fallback
}

export interface ChatContextAttachmentResult {
  sessionId: string
  sourceSessionId: string
  path: string
  messageCount: number
}

export interface ChatContextPreviewResult {
  sourceSessionId: string
  content: string
  messageCount: number
}

export async function fetchChatContextPreview(
  sourceSessionId: string,
  entries: LogEntry[] = [],
): Promise<ChatContextPreviewResult> {
  const encoded = encodeURIComponent(sourceSessionId)
  const resp = await fetch(
    `${getApiUrl()}/sessions/${encoded}/context-preview`,
    entries.length > 0 ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    } : undefined,
  )
  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    throw new Error(readErrorMessage(data, `chat context preview failed (${resp.status})`))
  }
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (typeof record.content !== 'string') {
    throw new Error('chat context preview response did not include content')
  }
  return {
    sourceSessionId: typeof record.source_session_id === 'string' ? record.source_session_id : sourceSessionId,
    content: record.content,
    messageCount: typeof record.message_count === 'number' ? record.message_count : 0,
  }
}

export async function attachChatContext(
  sessionId: string,
  sourceSessionId: string,
  entries: LogEntry[] = [],
): Promise<ChatContextAttachmentResult> {
  const encoded = encodeURIComponent(sessionId)
  const resp = await fetch(`${getApiUrl()}/projects/${encoded}/context/from-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_session_id: sourceSessionId,
      ...(entries.length > 0 ? { entries } : {}),
    }),
  })
  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    throw new Error(readErrorMessage(data, `chat context attachment failed (${resp.status})`))
  }
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (typeof record.path !== 'string' || !record.path) {
    throw new Error('chat context attachment response did not include a path')
  }
  return {
    sessionId: typeof record.session_id === 'string' ? record.session_id : sessionId,
    sourceSessionId: typeof record.source_session_id === 'string' ? record.source_session_id : sourceSessionId,
    path: record.path,
    messageCount: typeof record.message_count === 'number' ? record.message_count : 0,
  }
}

export async function deleteProject(
  sessionId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<DeleteProjectResult> {
  const deleteFiles = options.deleteFiles ?? true
  const encoded = encodeURIComponent(sessionId)
  const resp = deleteFiles
    ? await fetch(`${getApiUrl()}/projects?session_id=${encoded}`, { method: 'DELETE' })
    : await fetch(`${getApiUrl()}/projects/${encoded}/remove`, { method: 'POST' })

  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }

  if (!resp.ok) {
    throw new Error(readErrorMessage(data, `project delete failed (${resp.status})`))
  }

  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const result: DeleteProjectResult = {
    deleted: record.deleted === true,
    removed: record.removed === true || record.deleted === true,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
  }

  if (deleteFiles && !result.deleted) {
    throw new Error(result.reason || 'project files were not deleted')
  }
  if (!deleteFiles && !result.removed) {
    throw new Error(result.reason || 'project was not removed')
  }
  return result
}

export async function deleteProjectFiles(sessionId: string): Promise<boolean> {
  return (await deleteProject(sessionId, { deleteFiles: true })).deleted
}

export type FetchProjectFilesResult =
  | { ok: true; files: ProjectFileInfo[]; truncated: boolean }
  | { ok: false; status: number; error?: string }

function normalizeProjectFileRows(raw: unknown): ProjectFileInfo[] {
  if (!Array.isArray(raw)) return []
  const rows: ProjectFileInfo[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const path = typeof row.path === 'string' ? row.path : ''
    if (!path) continue
    const name = typeof row.name === 'string' ? row.name : path.split('/').pop() ?? path
    rows.push({
      name,
      path,
      size: typeof row.size === 'number' ? row.size : 0,
      mtime: typeof row.mtime === 'number' ? row.mtime : 0,
      is_dir: row.is_dir === true,
    })
  }
  return rows
}

export async function fetchProjectFilesResult(sessionId: string): Promise<FetchProjectFilesResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/files`)
    if (!resp.ok) {
      let error: string | undefined
      try {
        const data = await resp.json()
        error = typeof data?.error === 'string' ? data.error : undefined
      } catch {
        try {
          error = (await resp.text()).trim() || undefined
        } catch {
          error = undefined
        }
      }
      return { ok: false, status: resp.status, error }
    }
    const data = await resp.json()
    return { ok: true, files: normalizeProjectFileRows(data?.files), truncated: data?.truncated === true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { ok: false, status: 0, error: message }
  }
}

export async function fetchProjectFiles(sessionId: string): Promise<ProjectFileInfo[]> {
  const result = await fetchProjectFilesResult(sessionId)
  return result.ok ? result.files : []
}

export interface UploadedProjectFile {
  name: string
  path: string
  size: number
}

export interface ExtractedProjectFile {
  archive: string
  path: string
  size: number
}

export interface UploadProjectFilesResult {
  uploaded: UploadedProjectFile[]
  extracted: ExtractedProjectFile[]
}

export interface DataPathValidationResult {
  ok: boolean
  error?: string
  kind?: 'file' | 'directory'
  resolved_path?: string
  outside_workspace?: boolean
  restrict_to_workspace?: boolean
}

async function postUploadForm(url: string, files: File[], failure: string): Promise<Record<string, unknown>> {
  const formData = new FormData()
  for (const file of files) {
    const relativePath = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : ''
    formData.append('files', file, relativePath || file.name)
  }
  const resp = await fetch(url, { method: 'POST', body: formData })
  if (!resp.ok) {
    let msg = ''
    try {
      const data = await resp.json()
      msg = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
    } catch {
      msg = await resp.text()
    }
    throw new Error(msg || failure)
  }
  return resp.json()
}

/** Upload into a project folder; `dir` is relative to the project ('' is its root). */
export async function uploadProjectFiles(
  sessionId: string,
  files: File[],
  dir = '',
): Promise<UploadProjectFilesResult> {
  if (files.length === 0) return { uploaded: [], extracted: [] }
  const sid = encodeURIComponent(sessionId)
  const data = await postUploadForm(
    `${getApiUrl()}/projects/${sid}/files?dir=${encodeURIComponent(dir)}`,
    files,
    `Failed to upload files for ${sessionId}`,
  )
  return {
    uploaded: Array.isArray(data?.uploaded) ? data.uploaded as UploadedProjectFile[] : [],
    extracted: Array.isArray(data?.extracted) ? data.extracted as ExtractedProjectFile[] : [],
  }
}

/** Upload into a folder browsed outside a project (Quick Chat); `dir` is absolute. Returns absolute paths. */
export async function uploadToFolder(dir: string, files: File[]): Promise<UploadedProjectFile[]> {
  if (files.length === 0) return []
  const data = await postUploadForm(
    `${getApiUrl()}/fs/upload?dir=${encodeURIComponent(dir)}`,
    files,
    `Failed to upload files to ${dir}`,
  )
  return Array.isArray(data?.uploaded) ? data.uploaded as UploadedProjectFile[] : []
}

export async function validateDataPath(path: string, purpose?: 'experiment_input'): Promise<DataPathValidationResult> {
  const resp = await fetch(`${getApiUrl()}/data-path/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...(purpose ? { purpose } : {}) }),
  })
  if (!resp.ok) {
    let msg = ''
    try {
      const data = await resp.json()
      msg = typeof data?.error === 'string' ? data.error : JSON.stringify(data)
    } catch {
      msg = await resp.text()
    }
    return { ok: false, error: msg || 'validation request failed' }
  }
  const data = await resp.json()
  return {
    ok: !!data?.ok,
    error: typeof data?.error === 'string' ? data.error : undefined,
    kind: data?.kind === 'file' || data?.kind === 'directory' ? data.kind : undefined,
    resolved_path: typeof data?.resolved_path === 'string' ? data.resolved_path : undefined,
    ...(typeof data?.outside_workspace === 'boolean' ? { outside_workspace: data.outside_workspace } : {}),
    ...(typeof data?.restrict_to_workspace === 'boolean' ? { restrict_to_workspace: data.restrict_to_workspace } : {}),
  }
}

export function getProjectArtifactUrl(sessionId: string, artifactPath: string): string {
  const sid = encodeURIComponent(sessionId)
  const path = encodeURIComponent(artifactPath)
  return withEngineAuth(`${getApiUrl()}/projects/${sid}/artifacts?path=${path}`)
}

export function getFsFileUrl(path: string): string {
  return withEngineAuth(`${getApiUrl()}/fs/file?path=${encodeURIComponent(path)}`)
}

/** Preview/open URL for an explorer row, whether it belongs to a project or a browsed folder. */
export function getExplorerFileUrl(file: ProjectFileEntry): string {
  return file.absolutePath
    ? getFsFileUrl(file.absolutePath)
    : getProjectArtifactUrl(file.projectId, file.relativePath)
}

export interface ChatWorkdir {
  path: string
  exists: boolean
  home: string
}

/** The folder a Quick Chat works in; it may not exist before the chat's first turn. */
export async function fetchChatWorkdir(chatId: string): Promise<ChatWorkdir | null> {
  try {
    const resp = await fetch(`${getApiUrl()}/chats/${encodeURIComponent(chatId)}/workdir`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (typeof data?.path !== 'string' || !data.path) return null
    return { path: data.path, exists: data.exists === true, home: typeof data.home === 'string' ? data.home : '' }
  } catch {
    return null
  }
}

export interface DirectoryListing {
  path: string
  /** Null at the top of what the engine lets the explorer browse (the user's home). */
  parent: string | null
  home: string
  entries: ProjectFileInfo[]
  truncated: boolean
}

export type FetchDirectoryResult =
  | { ok: true; listing: DirectoryListing }
  | { ok: false; status: number; error?: string }

/** One level of a folder on the engine's machine. Entry paths are absolute. */
export async function fetchDirectory(path: string): Promise<FetchDirectoryResult> {
  try {
    const resp = await fetch(`${getApiUrl()}/fs/list?path=${encodeURIComponent(path)}`)
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: typeof data?.error === 'string' ? data.error : undefined }
    }
    return {
      ok: true,
      listing: {
        path: typeof data?.path === 'string' ? data.path : path,
        parent: typeof data?.parent === 'string' ? data.parent : null,
        home: typeof data?.home === 'string' ? data.home : '',
        entries: normalizeProjectFileRows(data?.entries),
        truncated: data?.truncated === true,
      },
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : undefined }
  }
}

export function getArtifactDownloadUrl(url: string): string {
  const downloadUrl = new URL(url, window.location.href)
  downloadUrl.searchParams.set('download', '1')
  return downloadUrl.toString()
}

export async function fetchSkillPlugins(sessionId: string): Promise<SkillPlugin[]> {
  try {
    const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins`)
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
  } catch {
    return []
  }
}

export async function installSkillPluginFromDirectory(sessionId: string, path: string): Promise<SkillPlugin[]> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function installSkillPluginFromZip(sessionId: string, zipFile: File): Promise<SkillPlugin[]> {
  const formData = new FormData()
  formData.append('zip', zipFile, zipFile.name)
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/install`, {
    method: 'POST',
    body: formData,
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function setSkillPluginState(
  sessionId: string,
  payload: {
    scope: SkillPluginScope
    target_type: SkillPluginTargetType
    plugin_id: string
    enabled: boolean
    target_id?: string
  },
): Promise<SkillPlugin[]> {
  const resp = await fetch(`${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

export async function uninstallSkillPlugin(sessionId: string, pluginId: string): Promise<SkillPlugin[]> {
  const resp = await fetch(
    `${getApiUrl()}/projects/${encodeURIComponent(sessionId)}/skill-plugins/${encodeURIComponent(pluginId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) {
    throw new Error(await resp.text())
  }
  const data = await resp.json()
  return Array.isArray(data?.plugins) ? (data.plugins as SkillPlugin[]) : []
}

/* Modular workflow v1 */

export async function fetchWorkflowSnapshot(projectId: string): Promise<import('@/types').WorkflowSnapshot> {
  const response = await fetch(`${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}`)
  if (!response.ok) throw new Error(await response.text())
  return await response.json() as import('@/types').WorkflowSnapshot
}

export async function createWorkflowRun(
  projectId: string,
  payload: {
    moduleType: import('@/types').WorkflowModuleType
    label?: string
    moduleData?: Record<string, unknown>
    inputs?: Array<{ artifact_id: string }>
    enqueue?: boolean
  },
): Promise<{ run_id: string; project_sequence: number }> {
  const response = await fetch(`${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_id: createUuid(),
      module_type: payload.moduleType,
      label: payload.label,
      module_data: payload.moduleData,
      inputs: payload.inputs,
      enqueue: payload.enqueue ?? false,
    }),
  })
  if (!response.ok) throw new Error(await response.text())
  return await response.json() as { run_id: string; project_sequence: number }
}

export async function importWorkflowArtifact(
  projectId: string,
  sourcePath: string,
  artifactType = 'file',
): Promise<import('@/types').WorkflowArtifact> {
  const response = await fetch(`${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_id: createUuid(),
      source_path: sourcePath,
      artifact_type: artifactType,
    }),
  })
  if (!response.ok) throw new Error(await response.text())
  const payload = await response.json() as { artifact: import('@/types').WorkflowArtifact }
  return payload.artifact
}

export async function fetchWorkflowArtifact(
  projectId: string,
  artifactId: string,
): Promise<import('@/types').WorkflowArtifact> {
  const response = await fetch(
    `${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
  )
  if (!response.ok) throw new Error(await response.text())
  return await response.json() as import('@/types').WorkflowArtifact
}

export function getWorkflowArtifactContentUrl(projectId: string, artifactId: string): string {
  return withEngineAuth(`${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/content`)
}

export async function commandWorkflowRun(
  projectId: string,
  runId: string,
  commandType: string,
  revision: number,
  payload?: Record<string, unknown>,
): Promise<{ project_sequence: number }> {
  const response = await fetch(
    `${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/commands`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: createUuid(),
        command_type: commandType,
        expected_revision: revision,
        payload: payload ?? {},
      }),
    },
  )
  if (!response.ok) throw new Error(await response.text())
  return await response.json() as { project_sequence: number }
}

export async function commandWorkflowProject(
  projectId: string,
  commandType: string,
  revision: number,
  payload?: Record<string, unknown>,
): Promise<{ project_sequence: number }> {
  const response = await fetch(
    `${getApiUrl()}/workflow/v1/projects/${encodeURIComponent(projectId)}/commands`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: createUuid(),
        command_type: commandType,
        expected_revision: revision,
        payload: payload ?? {},
      }),
    },
  )
  if (!response.ok) throw new Error(await response.text())
  return await response.json() as { project_sequence: number }
}
