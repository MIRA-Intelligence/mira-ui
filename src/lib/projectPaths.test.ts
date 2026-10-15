import { describe, expect, it } from 'vitest'
import { joinProjectPath } from './projectPaths'

describe('project directory preview', () => {
  it.each([
    ['/', '/study'],
    ['/data/', '/data/study'],
    ['C:\\', 'C:\\study'],
    ['C:\\Research Data\\', 'C:\\Research Data\\study'],
    ['\\\\server\\share', '\\\\server\\share\\study'],
  ])('joins %s with the project folder', (parent, expected) => {
    expect(joinProjectPath(parent, 'study')).toBe(expected)
  })
})
