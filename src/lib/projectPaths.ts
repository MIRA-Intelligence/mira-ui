export function slugifyProjectId(value: string): string {
  let text = value.trim().toLowerCase()
  text = text.replace(/[\\/:]/g, '-')
  text = text.split(/\s+/).filter(Boolean).join('-')
  while (text.includes('--')) text = text.replace(/--/g, '-')
  text = text.replace(/^[._-]+|[._-]+$/g, '')
  return text.slice(0, 128) || 'project'
}

export function joinProjectPath(parent: string, projectId: string): string {
  const base = parent.trim().replace(/[\\/]+$/, '')
  if (!base) return parent.trim().startsWith('/') ? `/${projectId}` : projectId
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return `${base}${separator}${projectId}`
}
