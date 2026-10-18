import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renderWord = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const pptxLoad = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const pptxRender = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('docx-preview', () => ({
  renderAsync: renderWord,
}))

vi.mock('pptxviewjs', () => ({
  PPTXViewer: class {
    loadFile = pptxLoad
    render = pptxRender
    getSlideCount = () => 2
    getCurrentSlideIndex = () => 0
    goToSlide = vi.fn().mockResolvedValue(undefined)
    destroy = vi.fn()
  },
}))

import type { WorkflowRun } from '@/types'
import { DeliverablePreview } from './DeliverablePreview'

function makeRun(outputPath: string): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'delivery-run',
    project_id: 'PRJ-1',
    module_type: 'delivery',
    label: 'Delivery',
    status: 'running',
    revision: 1,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:00:00Z',
    inputs: [],
    outputs: [],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:delivery-run',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: { output_path: outputPath },
  }
}

describe('DeliverablePreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens a generated Word document inline as soon as the output path exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['docx']),
    }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/article.docx')}
        lang="en"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('word-preview')).toBeInTheDocument())
    await waitFor(() => expect(renderWord).toHaveBeenCalled())
  })

  it('renders a generated PowerPoint inline with slide navigation state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/slides.pptx')}
        lang="en"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('powerpoint-preview')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
    expect(pptxLoad).toHaveBeenCalled()
    expect(pptxRender).toHaveBeenCalled()
  })

  it('runs bento slides in a script-only sandbox without same-origin access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/slides.bento.html')}
        lang="en"
      />,
    )

    const frame = await screen.findByTestId('slides-preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('opens slide decks in edit mode in a new tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/slides.mira.html')}
        lang="zh"
      />,
    )

    await screen.findByTestId('slides-preview')
    fireEvent.click(screen.getByRole('button', { name: '编辑幻灯' }))
    expect(open).toHaveBeenCalledTimes(1)
    const [url, target, features] = open.mock.calls[0]
    const opened = new URL(String(url))
    expect(opened.searchParams.get('mode')).toBe('edit')
    expect(opened.searchParams.get('path')).toBe('result/exports/slides.mira.html')
    expect(target).toBe('_blank')
    expect(features).toContain('noopener')
  })

  it('treats a stored slides artifact as a deck even when it is named payload.html', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artifact_id: 'art-deck',
        artifact_type: 'slides',
        label: '科学结果幻灯片',
        media_type: 'text/html',
        byte_size: 765867,
        payload_ref: '.mira/artifacts/art-deck/payload.html',
      }),
    }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={{ ...makeRun(''), outputs: ['art-deck'] }}
        lang="zh"
      />,
    )

    const frame = await screen.findByTestId('slides-preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    fireEvent.click(screen.getByRole('button', { name: '编辑幻灯' }))
    const opened = new URL(String(open.mock.calls[0][0]))
    expect(opened.pathname).toContain('/artifacts/art-deck/content')
    expect(opened.searchParams.get('mode')).toBe('edit')
  })

  it('keeps ordinary html fully sandboxed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/page.html')}
        lang="en"
      />,
    )

    const frame = await screen.findByTitle('page.html')
    expect(frame).toHaveAttribute('sandbox', '')
  })

  it('renders notebook markdown, code and outputs inline', async () => {
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: ['# Reproduction'] },
        {
          cell_type: 'code',
          source: ['print("auc")'],
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['auc=0.91\n'] },
            { output_type: 'display_data', data: { 'image/png': 'aGVsbG8=' } },
          ],
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => notebook }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/reproduction.ipynb')}
        lang="en"
      />,
    )

    const view = await screen.findByTestId('notebook-preview')
    expect(within(view).getByRole('heading', { name: 'Reproduction' })).toBeInTheDocument()
    expect(within(view).getByText('print("auc")')).toBeInTheDocument()
    expect(within(view).getByText(/auc=0\.91/)).toBeInTheDocument()
    expect(within(view).getByAltText('notebook output')).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
  })
})
