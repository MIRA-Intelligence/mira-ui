import { fetchProjectFiles } from './api'
import type { ProjectFileEntry, ProjectFileInfo } from '@/types'

export interface ProjectFilesSource {
  id: string
  label?: string
}

const DEFAULT_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const chunk = await Promise.all(batch.map(fn))
    results.push(...chunk)
  }
  return results
}

export async function fetchAllProjectFiles(
  projects: ProjectFilesSource[],
  concurrency = DEFAULT_CONCURRENCY,
): Promise<ProjectFileEntry[]> {
  if (projects.length === 0) return []

  const perProject = await mapWithConcurrency(projects, concurrency, async (project) => {
    try {
      const files = await fetchProjectFiles(project.id)
      return files.map((file) => ({
        ...file,
        projectId: project.id,
        relativePath: file.path,
        projectLabel: project.label,
        path: `${project.label || project.id}/${file.path}`,
      }))
    } catch {
      return []
    }
  })

  return perProject.flat()
}

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
