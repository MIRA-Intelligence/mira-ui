import type { ProjectFileEntry, ProjectFileInfo } from '@/types'

export function toProjectScopedEntries(
  projectId: string,
  files: ProjectFileInfo[],
): ProjectFileEntry[] {
  return files.map((file) => ({
    ...file,
    projectId,
    relativePath: file.path,
  }))
}
