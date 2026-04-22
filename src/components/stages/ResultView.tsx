import type { ResultData, ProjectTask } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'
import { getProjectArtifactUrl } from '@/services/api'
import { t } from '@/i18n'

type ExportFormat = 'experiment_report' | 'paper_article' | 'presentation' | 'metadata'

const EXPORT_CONFIG: Record<ExportFormat, {
  title: string
  skillPath: string
  outputPath: string
  outputType: string
  requirements: string
}> = {
  experiment_report: {
    title: 'Experiment Report',
    skillPath: 'mira_engine/skills/export/experiment-report/SKILL.md',
    outputPath: 'result/exports/experiment_report.md',
    outputType: 'report',
    requirements: 'Produce an objective markdown report summarizing project goal, setup, experiments, metrics, findings, and limitations.',
  },
  paper_article: {
    title: 'Paper Article',
    skillPath: 'mira_engine/skills/export/paper-article/SKILL.md',
    outputPath: 'result/exports/paper_article.md',
    outputType: 'paper',
    requirements: 'Write a journal-style article with Introduction, Method, Results, and Discussion sections using project evidence.',
  },
  presentation: {
    title: 'Presentation',
    skillPath: 'mira_engine/skills/export/presentation-beamer/SKILL.md',
    outputPath: 'result/exports/presentation.pdf',
    outputType: 'presentation',
    requirements: 'Generate a LaTeX Beamer deck and compile it to PDF. The required deliverable is result/exports/presentation.pdf (non-empty), with .tex source retained when possible.',
  },
  metadata: {
    title: 'Meta data',
    skillPath: 'mira_engine/skills/export/project-metadata/SKILL.md',
    outputPath: 'result/exports/project_metadata.zip',
    outputType: 'metadata',
    requirements: 'Package all files under the current project directory into a single zip archive for delivery.',
  },
}

function buildExportMessage(task: ProjectTask, format: ExportFormat): string {
  const cfg = EXPORT_CONFIG[format]
  return [
    `Manual export request for ${task.id}.`,
    '',
    `Target format: ${cfg.title}`,
    `Required skill: ${cfg.skillPath}`,
    `Output path: ${cfg.outputPath}`,
    `Output type: ${cfg.outputType}`,
    '',
    `Requirements: ${cfg.requirements}`,
    'Use task_plan.json and existing experiment artifacts as the source of truth.',
    'After finishing export, update task_plan.json.result with output_path, output_type, summary, and sections.',
  ].join('\n')
}

export function ResultView({ data, task }: { data: ResultData; task: ProjectTask }) {
  const lang = useSettingsStore((s) => s.language)
  const mode = useProjectStore((s) => s.mode)
  const agentProfile = useProjectStore((s) => s.agentProfile)
  const hasContent = data.summary || (data.sections?.length ?? 0) > 0

  const handleDownload = () => {
    if (!data.outputPath || !task.id) return
    const href = getProjectArtifactUrl(task.id, data.outputPath)
    const filename = data.outputPath.split('/').filter(Boolean).pop() || 'export'
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExport = (format: ExportFormat) => {
    const content = buildExportMessage(task, format)
    useAgentStore.getState().addLog(task.id, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content,
      type: 'response',
      metadata: { _user: true },
    })
    wsClient.send({
      type: 'message',
      content,
      session_id: task.id,
      user_id: 'ui_user',
      mode: task.runMode ?? mode,
      agent_profile: task.agentProfile ?? agentProfile,
      allow_result_write: true,
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {t('result', lang)}
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          {t('resultSubtitle', lang)}
        </p>

        <div className="mb-5 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1.5">
            {t('exportResultsLabel', lang)}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            {t('exportResultsHint', lang)}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleExport('experiment_report')}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {t('exportFormatReport', lang)}
            </button>
            <button
              type="button"
              onClick={() => handleExport('paper_article')}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {t('exportFormatPaper', lang)}
            </button>
            <button
              type="button"
              onClick={() => handleExport('presentation')}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {t('exportFormatPresentation', lang)}
            </button>
            <button
              type="button"
              onClick={() => handleExport('metadata')}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              {t('exportFormatMetadata', lang)}
            </button>
          </div>
        </div>

        {!hasContent && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-3xl mb-3">📝</div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              {t('noResultsYet', lang)}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
              {task.coreQuestion ? t('noResultsHintWithQuestion', lang) : t('noResultsHintGeneric', lang)}
            </p>
          </div>
        )}

        {/* Output file */}
        {data.outputPath && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center gap-3">
            <span className="text-lg">📁</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
                {t('output', lang)} {data.outputType ? `(${data.outputType})` : ''}
              </p>
              <p className="text-xs font-mono text-[var(--color-text-primary)] truncate mt-0.5">
                {data.outputPath}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              className="shrink-0 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t('downloadResultHint', lang)}
            >
              {t('downloadResult', lang)}
            </button>
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>✅</span> {t('summary', lang)}
            </h3>
            <div className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-[var(--color-bg-secondary)]">
              {data.summary}
            </div>
          </div>
        )}

        {/* Sections */}
        {data.sections && data.sections.length > 0 && (
          <div className="space-y-4">
            {data.sections.map((section, i) => (
              <div key={i}>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1.5 flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[var(--color-text-muted)]">{i + 1}.</span>
                  {section.title}
                </h3>
                <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap pl-5">
                  {section.content}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Knowledge summary */}
        {task.knowledge.length > 0 && (
          <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>💡</span> {t('keyFindings', lang)} ({task.knowledge.length})
            </h3>
            <ul className="space-y-1.5">
              {task.knowledge.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span className="text-[var(--color-success)] shrink-0 mt-0.5">•</span>
                  <span className="text-[var(--color-text-primary)]">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
