import { describe, expect, it } from 'vitest'

import { mapClientPathToServerPath } from './pathMapping'

describe('mapClientPathToServerPath', () => {
  it('returns original path when no mapping matches', () => {
    const result = mapClientPathToServerPath('/Users/alice/data', [
      { localPath: '/Users/bob', serverPath: '/mnt/data' },
    ])
    expect(result).toEqual({ path: '/Users/alice/data', applied: false })
  })

  it('maps matching prefix to server path', () => {
    const result = mapClientPathToServerPath('/Users/alice/data/case01', [
      { localPath: '/Users/alice/data', serverPath: '/srv/datasets' },
    ])
    expect(result).toEqual({ path: '/srv/datasets/case01', applied: true })
  })

  it('uses the longest matching mapping', () => {
    const result = mapClientPathToServerPath('/Users/alice/data/mri/set-a', [
      { localPath: '/Users/alice/data', serverPath: '/srv/datasets' },
      { localPath: '/Users/alice/data/mri', serverPath: '/mnt/mri' },
    ])
    expect(result).toEqual({ path: '/mnt/mri/set-a', applied: true })
  })
})
