import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wsSend = vi.hoisted(() => vi.fn())
vi.mock('@/services/websocket', () => ({
  wsClient: { send: wsSend, connect: vi.fn(), disconnect: vi.fn(), onMessage: vi.fn(), onStatus: vi.fn() },
}))

import { ResultView } from './ResultView'
import type { ProjectTask, ResultData } from '@/types'
import { useAgentStore } from '@/stores/agentStore'
import { useSettingsStore } from '@/stores/settingsStore'

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'PRJ-1',
    label: 'P',
    status: 'completed',
    title: 'Project',
    coreQuestion: 'Why?',
    experiments: [],
    knowledge: [],
    research: { references: [], notes: [] },
    result: {},
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ResultView', () => {
  beforeEach(() => {
    wsSend.mockClear()
    useSettingsStore.setState({ language: 'en' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state when there is no result content', () => {
    render(<ResultView data={{}} task={makeTask()} />)
    expect(screen.getByText('📝')).toBeInTheDocument()
  })

  it('renders summary, sections, output file and key findings', () => {
    const data: ResultData = {
      summary: 'Final summary',
      outputPath: '/proj/out/report.md',
      outputType: 'markdown',
      sections: [{ title: 'Intro', content: 'body text' }],
    }
    const task = makeTask({ result: data, knowledge: ['finding A', 'finding B'] })
    render(<ResultView data={data} task={task} />)

    expect(screen.getByText('Final summary')).toBeInTheDocument()
    expect(screen.getByText('Intro')).toBeInTheDocument()
    expect(screen.getByText('body text')).toBeInTheDocument()
    expect(screen.getByText('/proj/out/report.md')).toBeInTheDocument()
    expect(screen.getByText('finding A')).toBeInTheDocument()
  })

  it('sends an export message and logs it when an export format is chosen', () => {
    const task = makeTask({ result: { summary: 's' } })
    render(<ResultView data={task.result} task={task} />)
    const reportBtn = screen.getByText('Experiment Report', { exact: false })
    fireEvent.click(reportBtn)
    expect(wsSend).toHaveBeenCalledTimes(1)
    const logs = useAgentStore.getState().logsByProject['PRJ-1'] ?? []
    expect(logs.length).toBeGreaterThan(0)
  })

  it('triggers a download for the output artifact', () => {
    const clickSpy = vi.fn()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    }) as never)
    const data: ResultData = { outputPath: '/p/out.csv' }
    render(<ResultView data={data} task={makeTask({ result: data })} />)
    fireEvent.click(screen.getByTitle(/download/i))
    expect(clickSpy).toHaveBeenCalled()
  })
})
