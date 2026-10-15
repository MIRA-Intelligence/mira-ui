import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchAllProjectFiles, toProjectScopedEntries } from './projectFiles'
import * as api from './api'

describe('projectFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prefixes paths with project label when available', async () => {
    vi.spyOn(api, 'fetchProjectFiles').mockImplementation(async (id: string) => {
      if (id === 'PRJ-A') return [{ name: 'a.csv', path: 'data/a.csv', size: 1, mtime: 0, is_dir: false }]
      if (id === 'PRJ-B') return [{ name: 'b.csv', path: 'data/b.csv', size: 2, mtime: 0, is_dir: false }]
      return []
    })

    const files = await fetchAllProjectFiles([{ id: 'PRJ-A', label: 'test' }, { id: 'PRJ-B' }], 2)

    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({
      projectId: 'PRJ-A',
      relativePath: 'data/a.csv',
      path: 'test/data/a.csv',
      projectLabel: 'test',
    })
    expect(files[1]).toMatchObject({
      projectId: 'PRJ-B',
      relativePath: 'data/b.csv',
      path: 'PRJ-B/data/b.csv',
    })
  })

  it('continues when one project file fetch fails', async () => {
    vi.spyOn(api, 'fetchProjectFiles').mockImplementation(async (id: string) => {
      if (id === 'PRJ-ERR') throw new Error('network')
      return [{ name: 'ok.txt', path: 'data/ok.txt', size: 1, mtime: 0, is_dir: false }]
    })

    const files = await fetchAllProjectFiles([{ id: 'PRJ-ERR' }, { id: 'PRJ-OK' }])

    expect(files).toHaveLength(1)
    expect(files[0].projectId).toBe('PRJ-OK')
  })

  it('maps single-project entries with relative paths', () => {
    const entries = toProjectScopedEntries('PRJ-1', [
      { name: 'x.txt', path: 'data/x.txt', size: 3, mtime: 1, is_dir: false },
    ])
    expect(entries[0]).toEqual({
      name: 'x.txt',
      path: 'data/x.txt',
      size: 3,
      mtime: 1,
      is_dir: false,
      projectId: 'PRJ-1',
      relativePath: 'data/x.txt',
    })
  })
})
