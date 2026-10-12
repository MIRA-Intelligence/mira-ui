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
  it('uses selected journal headings instead of the generic article structure', () => {
    const message = buildExportMessage(task, 'paper_article', { workflow: true, targetJournal: 'radiology' })
    expect(message).toContain('Target journal profile: radiology')
    expect(message).not.toContain('Write it in a regular journal article structure')
    expect(message).not.toContain('Verify the document contains Introduction')
    expect(message).toContain('Do not fabricate citations')
    expect(buildExportMessage(task, 'presentation', { targetJournal: 'radiology' })).not.toContain('Target journal profile')
  })
  it.each(['experiment_report', 'paper_article', 'presentation', 'metadata'] as const)(
    'scopes native %s delivery to the selected experiment without legacy plan writes', (format) => {
      const message = buildExportMessage(task, format, { workflow: true })
      expect(message).toContain('configuration.selected_experiment')
      expect(message).toContain('Shared attachments')
      expect(message).toContain('publish_workflow_artifact')
      expect(message).toContain('complete_workflow_run')
      expect(message).not.toContain('task_plan.json')
      expect(buildExportMessage(task, format)).toContain('task_plan.json.result')
    },
  )
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
