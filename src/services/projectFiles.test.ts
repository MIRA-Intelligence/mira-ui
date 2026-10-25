import { describe, expect, it } from 'vitest'

import { toProjectScopedEntries } from './projectFiles'

describe('projectFiles', () => {
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
