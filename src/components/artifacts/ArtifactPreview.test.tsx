import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactPreview } from './ArtifactPreview'

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_buffer: ArrayBuffer, container: HTMLElement) => {
    container.innerHTML = '<p>docx body</p>'
    return []
  }),
}))

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_csv: vi.fn(() => 'colA,colB\n1,2') },
}))

vi.mock('pptx-preview', () => ({
  init: vi.fn((dom: HTMLElement) => ({
    preview: vi.fn(async () => {
      const first = document.createElement('div')
      first.textContent = 'slide one'
      const second = document.createElement('div')
      second.textContent = 'slide two'
      dom.append(first, second)
    }),
    destroy: vi.fn(),
  })),
}))

function mockFileFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 0]))),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ArtifactPreview', () => {
  it('renders image content immediately on dedicated preview surfaces', () => {
    render(
      <ArtifactPreview
        path="figures/result.png"
        url="/api/projects/PRJ-0001/artifacts?path=figures/result.png"
        label="result.png"
        bodyOnly
      />,
    )

    expect(screen.getByRole('img', { name: 'figures/result.png' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'result.png' })).not.toBeInTheDocument()
  })

  it('keeps the disclosure row in compact artifact lists', () => {
    render(
      <ArtifactPreview
        path="figures/result.png"
        url="/api/projects/PRJ-0001/artifacts?path=figures/result.png"
        label="result.png"
      />,
    )

    expect(screen.getByRole('button', { name: /result\.png/i })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'figures/result.png' })).not.toBeInTheDocument()
  })

  it('renders pdf through an iframe', () => {
    const { container } = render(
      <ArtifactPreview
        path="paper.pdf"
        url="/api/projects/PRJ-0001/artifacts?path=paper.pdf"
        bodyOnly
      />,
    )

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('src', '/api/projects/PRJ-0001/artifacts?path=paper.pdf')
  })

  it('renders docx content through docx-preview', async () => {
    mockFileFetch()
    render(
      <ArtifactPreview
        path="report.docx"
        url="/api/projects/PRJ-0001/artifacts?path=report.docx"
        bodyOnly
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('docx body')).toBeInTheDocument()
    })
  })

  it('renders xlsx sheets as a table', async () => {
    mockFileFetch()
    render(
      <ArtifactPreview
        path="budget.xlsx"
        url="/api/projects/PRJ-0001/artifacts?path=budget.xlsx"
        bodyOnly
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('colA')).toBeInTheDocument()
    })
    expect(screen.getByText('colB')).toBeInTheDocument()
  })

  it('shows failed Excel downloads instead of loading forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    render(<ArtifactPreview path="missing.xlsx" url="/missing.xlsx" bodyOnly />)
    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument()
  })

  it('renders all pptx slides in list mode', async () => {
    mockFileFetch()
    render(
      <ArtifactPreview
        path="slides.pptx"
        url="/api/projects/PRJ-0001/artifacts?path=slides.pptx"
        bodyOnly
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('slide one')).toBeInTheDocument()
    })
    expect(screen.getByText('slide two')).toBeInTheDocument()
  })
})
