import { describe, expect, it } from 'vitest'

import { detectArtifactKind, isPreviewableInline } from './detectKind'

describe('detectArtifactKind', () => {
  it.each([
    ['plot.png', 'image'],
    ['fig.JPG', 'image'],
    ['vector.svg', 'image'],
    ['data.json', 'json'],
    ['stream.JSONL', 'json'],
    ['table.csv', 'csv'],
    ['table.tsv', 'tsv'],
    ['report.md', 'markdown'],
    ['notes.markdown', 'markdown'],
    ['run.log', 'text'],
    ['script.py', 'text'],
    ['config.yaml', 'text'],
    ['paper.pdf', 'pdf'],
    ['index.html', 'html'],
    ['take.mp3', 'audio'],
    ['movie.mp4', 'video'],
  ])('detects %s as %s', (path, expected) => {
    expect(detectArtifactKind(path)).toBe(expected)
  })

  it('falls back to binary for unknown extensions', () => {
    expect(detectArtifactKind('weights.bin')).toBe('binary')
    expect(detectArtifactKind('archive.tar.gz')).toBe('binary')
  })

  it('treats files without extension as binary', () => {
    expect(detectArtifactKind('LICENSE')).toBe('binary')
    expect(detectArtifactKind('trailing.')).toBe('binary')
  })

  it('strips query/hash before matching', () => {
    expect(detectArtifactKind('plot.png?v=2')).toBe('image')
    expect(detectArtifactKind('plot.png#frag')).toBe('image')
  })

  it('isPreviewableInline matches the documented set', () => {
    expect(isPreviewableInline('image')).toBe(true)
    expect(isPreviewableInline('json')).toBe(true)
    expect(isPreviewableInline('csv')).toBe(true)
    expect(isPreviewableInline('tsv')).toBe(true)
    expect(isPreviewableInline('markdown')).toBe(true)
    expect(isPreviewableInline('text')).toBe(true)
    expect(isPreviewableInline('pdf')).toBe(false)
    expect(isPreviewableInline('binary')).toBe(false)
  })
})
