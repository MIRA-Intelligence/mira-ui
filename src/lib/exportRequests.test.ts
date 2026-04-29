import { describe, expect, it } from 'vitest'

import { buildExportMessage } from './exportRequests'
import type { ProjectTask } from '@/types'

const task: ProjectTask = {
  id: 'PRJ-0001',
  label: 'PRJ-0001',
  status: 'in_progress',
  title: 'Demo',
  coreQuestion: 'demo question',
  experiments: [],
  knowledge: [],
  research: { references: [], notes: [] },
  result: {},
  startedAt: new Date().toISOString(),
}

describe('buildExportMessage', () => {
  it('requests a real journal article docx with required sections and figures/tables', () => {
    const message = buildExportMessage(task, 'paper_article')

    expect(message).toContain('result/exports/journal_article.docx')
    expect(message).toContain('Word-compatible .docx')
    expect(message).toContain('Introduction')
    expect(message).toContain('Methods')
    expect(message).toContain('Results')
    expect(message).toContain('Discussion')
    expect(message).toContain('Conclusion')
    expect(message).toContain('figures')
    expect(message).toContain('tables')
    expect(message).toContain('mira_engine/skills/documents/docx/SKILL.md')
  })
})
