export type PathMapping = {
  localPath: string
  serverPath: string
}

type MappingResult = {
  path: string
  applied: boolean
}

function normalizePath(input: string): string {
  const normalized = input.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (normalized === '/') return normalized
  return normalized.replace(/\/+$/, '')
}

export function mapClientPathToServerPath(rawPath: string, mappings: PathMapping[]): MappingResult {
  const sourcePath = rawPath.trim()
  if (!sourcePath) return { path: '', applied: false }

  const normalizedSource = normalizePath(sourcePath)
  let bestMapping: PathMapping | null = null
  let bestLocal = ''
  let bestServer = ''

  for (const mapping of mappings) {
    const local = normalizePath(mapping.localPath)
    const server = normalizePath(mapping.serverPath)
    if (!local || !server) continue

    if (normalizedSource === local || normalizedSource.startsWith(`${local}/`)) {
      if (local.length > bestLocal.length) {
        bestLocal = local
        bestServer = server
        bestMapping = mapping
      }
    }
  }

  if (!bestMapping) {
    return { path: sourcePath, applied: false }
  }

  const suffix = normalizedSource.slice(bestLocal.length)
  return { path: `${bestServer}${suffix}`, applied: true }
}
