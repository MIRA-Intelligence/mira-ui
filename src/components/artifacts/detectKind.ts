export type ArtifactKind =
  | 'image'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'html'
  | 'audio'
  | 'video'
  | 'binary'

const EXT_MAP: Record<string, ArtifactKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  json: 'json',
  jsonl: 'json',
  ndjson: 'json',
  geojson: 'json',
  csv: 'csv',
  tsv: 'tsv',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  py: 'text',
  ts: 'text',
  tsx: 'text',
  js: 'text',
  jsx: 'text',
  yaml: 'text',
  yml: 'text',
  toml: 'text',
  ini: 'text',
  sh: 'text',
  sql: 'text',
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
}

export function detectArtifactKind(path: string): ArtifactKind {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot === path.length - 1) return 'binary'
  const ext = path.slice(dot + 1).toLowerCase().split('?')[0].split('#')[0]
  return EXT_MAP[ext] ?? 'binary'
}

const KIND_ICON: Record<ArtifactKind, string> = {
  image: '🖼',
  json: '{}',
  csv: '▦',
  tsv: '▦',
  markdown: '¶',
  text: '⌨',
  pdf: '📄',
  html: '◧',
  audio: '♪',
  video: '▶',
  binary: '⛁',
}

export function iconForKind(kind: ArtifactKind): string {
  return KIND_ICON[kind]
}

export function isPreviewableInline(kind: ArtifactKind): boolean {
  return (
    kind === 'image' ||
    kind === 'json' ||
    kind === 'csv' ||
    kind === 'tsv' ||
    kind === 'markdown' ||
    kind === 'text'
  )
}
