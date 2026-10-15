import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  fetchWorkflowArtifact,
  getProjectArtifactUrl,
  getWorkflowArtifactContentUrl,
} from '@/services/api'
import type { WorkflowArtifact, WorkflowRun } from '@/types'

type PreviewArtifact = {
  id: string
  name: string
  mediaType: string
  byteSize?: number
  url: string
  probeUntilAvailable?: boolean
}

function extensionOf(name: string): string {
  const clean = name.split(/[?#]/, 1)[0]
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot).toLowerCase() : ''
}

function artifactName(artifact: WorkflowArtifact): string {
  const label = artifact.label.trim()
  if (extensionOf(label)) return label
  const payloadName = artifact.payload_ref.split('/').filter(Boolean).at(-1)
  return payloadName || label || artifact.artifact_id
}

function formatBytes(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function previewKind(artifact: PreviewArtifact):
  'pdf' | 'docx' | 'pptx' | 'image' | 'text' | 'html' | 'slides' | 'notebook' | 'unsupported' {
  const extension = extensionOf(artifact.name)
  const mediaType = artifact.mediaType.toLowerCase()
  if (extension === '.pdf' || mediaType === 'application/pdf') return 'pdf'
  if (extension === '.docx' || mediaType.includes('wordprocessingml')) return 'docx'
  if (extension === '.pptx' || mediaType.includes('presentationml')) return 'pptx'
  if (mediaType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return 'image'
  }
  if (artifact.name.toLowerCase().endsWith('.bento.html')) return 'slides'
  if (extension === '.ipynb') return 'notebook'
  if (extension === '.html' || extension === '.htm' || mediaType === 'text/html') return 'html'
  if (
    mediaType.startsWith('text/')
    || ['.md', '.txt', '.json', '.csv', '.log', '.py', '.r'].includes(extension)
  ) {
    return 'text'
  }
  return 'unsupported'
}

function DownloadLink({
  artifact,
  lang,
}: {
  artifact: PreviewArtifact
  lang: 'zh' | 'en'
}) {
  return (
    <a
      href={artifact.url}
      download={artifact.name}
      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
    >
      {lang === 'zh' ? '下载原文件' : 'Download original'}
    </a>
  )
}

function WordPreview({ artifact, lang }: { artifact: PreviewArtifact; lang: 'zh' | 'en' }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.replaceChildren()
    setError(null)
    void (async () => {
      const response = await fetch(artifact.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const { renderAsync } = await import('docx-preview')
      if (cancelled || !containerRef.current) return
      await renderAsync(blob, containerRef.current, undefined, {
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
      })
    })().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      cancelled = true
      container.replaceChildren()
    }
  }, [artifact.url])

  if (error) {
    return (
      <div className="flex min-h-64 items-center justify-center p-8 text-center text-xs text-[var(--color-danger)]">
        {lang === 'zh' ? `Word 预览失败：${error}` : `Word preview failed: ${error}`}
      </div>
    )
  }
  return (
    <div
      ref={containerRef}
      data-testid="word-preview"
      className="min-h-64 overflow-auto bg-neutral-200 p-5 text-black [&_.docx-wrapper]:!bg-transparent [&_section.docx]:mx-auto"
    />
  )
}

function PowerPointPreview({ artifact, lang }: { artifact: PreviewArtifact; lang: 'zh' | 'en' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<import('pptxviewjs').PPTXViewer | null>(null)
  const [slide, setSlide] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSlide(0)
    setSlideCount(0)
    setError(null)
    void (async () => {
      const response = await fetch(artifact.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.arrayBuffer()
      const { PPTXViewer } = await import('pptxviewjs')
      if (cancelled || !canvasRef.current) return
      const viewer = new PPTXViewer({ canvas: canvasRef.current, slideSizeMode: 'fit' })
      viewerRef.current = viewer
      await viewer.loadFile(data)
      if (cancelled) return
      await viewer.render(canvasRef.current)
      setSlideCount(viewer.getSlideCount())
      setSlide(viewer.getCurrentSlideIndex())
    })().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      cancelled = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [artifact.url])

  const move = (direction: -1 | 1) => {
    const viewer = viewerRef.current
    if (!viewer || !canvasRef.current) return
    const next = Math.min(Math.max(slide + direction, 0), Math.max(slideCount - 1, 0))
    void viewer.goToSlide(next, canvasRef.current).then(() => setSlide(next)).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div data-testid="powerpoint-preview" className="flex min-h-64 flex-col bg-neutral-950">
      {error ? (
        <div className="flex min-h-64 items-center justify-center p-8 text-center text-xs text-red-400">
          {lang === 'zh' ? `PowerPoint 预览失败：${error}` : `PowerPoint preview failed: ${error}`}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            <canvas ref={canvasRef} className="max-h-full max-w-full bg-white shadow-xl" />
          </div>
          {slideCount > 0 && (
            <div className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-2 text-xs text-neutral-300">
              <button type="button" disabled={slide <= 0} onClick={() => move(-1)} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30">
                ←
              </button>
              <span>{slide + 1} / {slideCount}</span>
              <button type="button" disabled={slide >= slideCount - 1} onClick={() => move(1)} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30">
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TextPreview({ artifact }: { artifact: PreviewArtifact }) {
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setContent('')
    setError(null)
    void fetch(artifact.url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((value) => {
        if (!cancelled) setContent(value)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [artifact.url])
  if (error) return <div className="p-5 text-xs text-[var(--color-danger)]">{error}</div>
  return (
    <div className="prose prose-sm max-w-none overflow-auto p-5 text-[var(--color-text-primary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

type NotebookCell = {
  cell_type?: string
  source?: string | string[]
  outputs?: Array<Record<string, unknown>>
  execution_count?: number | null
}

function joinLines(value: unknown): string {
  if (Array.isArray(value)) return value.join('')
  return typeof value === 'string' ? value : ''
}

function NotebookOutput({ output }: { output: Record<string, unknown> }) {
  const type = output.output_type
  if (type === 'stream') {
    return <pre className="overflow-auto whitespace-pre-wrap bg-black/5 px-3 py-2 text-xs">{joinLines(output.text)}</pre>
  }
  if (type === 'error') {
    const trace = joinLines(output.traceback).replace(/\u001b\[[0-9;]*m/g, '')
    return <pre className="overflow-auto whitespace-pre-wrap bg-red-500/10 px-3 py-2 text-xs text-[var(--color-danger)]">{trace || `${output.ename}: ${output.evalue}`}</pre>
  }
  const data = (output.data ?? {}) as Record<string, unknown>
  const png = joinLines(data['image/png']).replace(/\s+/g, '')
  if (png) {
    return <img src={`data:image/png;base64,${png}`} alt="notebook output" className="max-w-full bg-white px-3 py-2" />
  }
  const text = joinLines(data['text/plain'])
  return text ? <pre className="overflow-auto whitespace-pre-wrap bg-black/5 px-3 py-2 text-xs">{text}</pre> : null
}

function NotebookPreview({ artifact }: { artifact: PreviewArtifact }) {
  const [cells, setCells] = useState<NotebookCell[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setCells(null)
    setError(null)
    void fetch(artifact.url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ cells?: NotebookCell[] }>
      })
      .then((notebook) => {
        if (!cancelled) setCells(Array.isArray(notebook.cells) ? notebook.cells : [])
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [artifact.url])
  if (error) return <div className="p-5 text-xs text-[var(--color-danger)]">{error}</div>
  if (!cells) return <div className="p-5 text-xs text-[var(--color-text-muted)]">…</div>
  return (
    <div data-testid="notebook-preview" className="max-h-[70vh] min-h-64 space-y-3 overflow-auto p-5">
      {cells.map((cell, index) => {
        const source = joinLines(cell.source)
        if (cell.cell_type === 'markdown') {
          return (
            <div key={index} className="prose prose-sm max-w-none text-[var(--color-text-primary)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
            </div>
          )
        }
        return (
          <div key={index} className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <pre className="overflow-auto bg-[var(--color-bg-secondary)] px-3 py-2 text-xs"><code>{source}</code></pre>
            {(cell.outputs ?? []).map((output, outputIndex) => (
              <NotebookOutput key={outputIndex} output={output} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ArtifactBody({
  artifact,
  lang,
}: {
  artifact: PreviewArtifact
  lang: 'zh' | 'en'
}) {
  const kind = previewKind(artifact)
  if (kind === 'pdf') {
    return <iframe title={artifact.name} src={artifact.url} className="h-[70vh] min-h-[520px] w-full bg-white" />
  }
  if (kind === 'docx') return <WordPreview artifact={artifact} lang={lang} />
  if (kind === 'pptx') return <PowerPointPreview artifact={artifact} lang={lang} />
  if (kind === 'image') {
    return <div className="flex min-h-64 justify-center bg-black/5 p-4"><img src={artifact.url} alt={artifact.name} className="max-h-[70vh] max-w-full object-contain" /></div>
  }
  if (kind === 'html') {
    return <iframe title={artifact.name} src={artifact.url} sandbox="" className="h-[70vh] min-h-[520px] w-full bg-white" />
  }
  if (kind === 'slides') {
    // bento decks need JS. `allow-scripts` WITHOUT `allow-same-origin` keeps the
    // generated HTML in an opaque origin so it cannot read the engine token that
    // rides in this URL's query string or call the engine API. Do not relax this.
    return (
      <iframe
        title={artifact.name}
        src={artifact.url}
        sandbox="allow-scripts"
        allow="fullscreen"
        allowFullScreen
        data-testid="slides-preview"
        className="h-[70vh] min-h-[520px] w-full bg-white"
      />
    )
  }
  if (kind === 'notebook') return <NotebookPreview artifact={artifact} />
  if (kind === 'text') return <TextPreview artifact={artifact} />
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-4xl">📦</div>
      <p className="text-sm text-[var(--color-text-primary)]">{artifact.name}</p>
      <p className="text-xs text-[var(--color-text-muted)]">
        {lang === 'zh' ? '此格式暂不支持内嵌预览，可下载原文件查看。' : 'This format cannot be previewed inline yet.'}
      </p>
      <DownloadLink artifact={artifact} lang={lang} />
    </div>
  )
}

export function DeliverablePreview({
  projectId,
  run,
  legacyOutputPath,
  lang,
}: {
  projectId: string
  run: WorkflowRun
  legacyOutputPath?: string
  lang: 'zh' | 'en'
}) {
  const [artifacts, setArtifacts] = useState<PreviewArtifact[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [availablePaths, setAvailablePaths] = useState<Record<string, boolean>>({})
  const configuredPath = typeof run.module_data.output_path === 'string'
    ? run.module_data.output_path.trim()
    : ''

  useEffect(() => {
    let cancelled = false
    setError(null)
    void (async () => {
      if (run.outputs.length > 0) {
        const metadata = await Promise.all(
          run.outputs.map((artifactId) => fetchWorkflowArtifact(projectId, artifactId)),
        )
        return metadata.map((artifact): PreviewArtifact => ({
          id: artifact.artifact_id,
          name: artifactName(artifact),
          mediaType: artifact.media_type,
          byteSize: artifact.byte_size,
          url: getWorkflowArtifactContentUrl(projectId, artifact.artifact_id),
        }))
      }
      const outputPath = configuredPath || legacyOutputPath?.trim()
      if (!outputPath) return []
      return [{
        id: `path:${outputPath}`,
        name: outputPath.split('/').filter(Boolean).at(-1) || outputPath,
        mediaType: '',
        url: getProjectArtifactUrl(projectId, outputPath),
        probeUntilAvailable: true,
      }]
    })().then((next) => {
      if (cancelled) return
      setArtifacts(next)
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? null)
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [configuredPath, legacyOutputPath, projectId, run.outputs])

  useEffect(() => {
    const pending = artifacts.filter((artifact) => (
      artifact.probeUntilAvailable && !availablePaths[artifact.id]
    ))
    if (pending.length === 0) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const probe = async () => {
      const checks = await Promise.all(pending.map(async (artifact) => {
        try {
          const response = await fetch(artifact.url, { method: 'HEAD' })
          return [artifact.id, response.ok] as const
        } catch {
          return [artifact.id, false] as const
        }
      }))
      if (cancelled) return
      const found = checks.filter(([, available]) => available)
      if (found.length > 0) {
        setAvailablePaths((current) => ({
          ...current,
          ...Object.fromEntries(found),
        }))
      }
      const stillMissing = checks.some(([, available]) => !available)
      if (stillMissing && ['created', 'queued', 'running', 'waiting_input', 'paused'].includes(run.status)) {
        timer = setTimeout(probe, 2000)
      }
    }
    void probe()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [artifacts, availablePaths, run.status])

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0],
    [artifacts, selectedId],
  )

  if (error) {
    return <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-4 text-xs text-[var(--color-danger)]">{error}</div>
  }
  if (!selected) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center">
        <div className="text-3xl">📝</div>
        <p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
          {lang === 'zh' ? '正在准备交付物' : 'Preparing deliverables'}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {lang === 'zh' ? '文件生成后会自动显示在这里。' : 'Generated files will appear here automatically.'}
        </p>
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-[var(--color-text-primary)]">{selected.name}</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">
            {[selected.mediaType, formatBytes(selected.byteSize)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <DownloadLink artifact={selected} lang={lang} />
      </div>
      {artifacts.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] p-2">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => setSelectedId(artifact.id)}
              className={[
                'max-w-52 shrink-0 truncate rounded-md px-2.5 py-1.5 text-xs',
                artifact.id === selected.id
                  ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]',
              ].join(' ')}
            >
              {artifact.name}
            </button>
          ))}
        </div>
      )}
      {selected.probeUntilAvailable && !availablePaths[selected.id] ? (
        <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
          <div className="text-3xl">⏳</div>
          <p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
            {run.status === 'completed'
              ? (lang === 'zh' ? '交付文件尚未找到' : 'Deliverable file was not found')
              : (lang === 'zh' ? 'Mira 正在生成这个文件' : 'Mira is generating this file')}
          </p>
          <p className="mt-1 max-w-md text-xs text-[var(--color-text-muted)]">
            {lang === 'zh'
              ? '文件写入完成后会自动在此处打开，无需返回总览页。'
              : 'It will open here automatically as soon as it has been written.'}
          </p>
        </div>
      ) : (
        <ArtifactBody artifact={selected} lang={lang} />
      )}
    </section>
  )
}
