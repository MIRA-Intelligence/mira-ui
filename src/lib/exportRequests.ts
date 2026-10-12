import type { ProjectTask } from '@/types'

export type ExportFormat = 'experiment_report' | 'paper_article' | 'presentation' | 'metadata'

export type ExportConfig = {
  title: string
  outputPath: string
  outputType: string
  recommendedSkills: string[]
  requirements: string[]
  verification: string[]
}

const EXPORT_CONFIG: Record<ExportFormat, ExportConfig> = {
  experiment_report: {
    title: 'Experiment Report',
    outputPath: 'result/exports/experiment_report.md',
    outputType: 'report',
    recommendedSkills: [
      'mira_engine/skills/visualization/scientific-visualization/SKILL.md',
    ],
    requirements: [
      'Produce an objective Markdown report summarizing project goal, data, setup, experiments, metrics, findings, limitations, and next steps.',
      'Include figure/table references when existing project artifacts support them.',
      'Do not invent results. Use task_plan.json and existing project artifacts as the source of truth.',
    ],
    verification: [
      'Write a non-empty Markdown file at result/exports/experiment_report.md.',
    ],
  },
  paper_article: {
    title: 'Journal Article (.docx)',
    outputPath: 'result/exports/journal_article.docx',
    outputType: 'article_docx',
    recommendedSkills: [
      'mira_engine/skills/documents/docx/SKILL.md',
      'mira_engine/skills/visualization/scientific-visualization/SKILL.md',
    ],
    requirements: [
      'Create a real Word-compatible .docx manuscript, not a Markdown-only draft.',
      'Write it in a regular journal article structure with these required sections: Abstract, Keywords, Introduction, Methods, Results, Discussion, and Conclusion.',
      'The Introduction must ground the research question in the project literature/references when available.',
      'The Methods must describe data, preprocessing, models/statistical methods, validation strategy, and experimental protocol from task_plan.json and artifacts.',
      'The Results must report completed experiments with numeric metrics, uncertainty or fold-level details when available, and clear comparisons.',
      'The Discussion must interpret findings, limitations, failure modes, clinical/scientific relevance, and future work.',
      'Include necessary numbered tables and figures. Use existing images/plots/artifacts when available; otherwise create concise summary tables from experiment metrics. Every figure/table needs a caption and must be referenced in the text.',
      'Add a References section using the project research.references entries and any user-provided reference materials. Do not fabricate citations.',
      'Keep a source draft at result/exports/journal_article_source.md when practical, but the required deliverable is the .docx file.',
    ],
    verification: [
      'Write a non-empty .docx file at result/exports/journal_article.docx.',
      'Verify the document contains Introduction, Methods, Results, Discussion, and Conclusion headings.',
      'Verify at least one table or figure is included when project evidence/artifacts make one possible.',
    ],
  },
  presentation: {
    title: 'Presentation',
    outputPath: 'result/exports/presentation.pdf',
    outputType: 'presentation',
    recommendedSkills: [
      'mira_engine/skills/visualization/scientific-slides/SKILL.md',
      'mira_engine/skills/visualization/scientific-visualization/SKILL.md',
    ],
    requirements: [
      'Generate a concise scientific slide deck from the project evidence.',
      'Retain editable source files when possible.',
      'Use task_plan.json and existing experiment artifacts as the source of truth.',
    ],
    verification: [
      'Write a non-empty PDF file at result/exports/presentation.pdf.',
    ],
  },
  metadata: {
    title: 'Meta data',
    outputPath: 'result/exports/project_metadata.zip',
    outputType: 'metadata',
    recommendedSkills: [],
    requirements: [
      'Package relevant project files, task_plan.json, experiment artifacts, and metadata into a single zip archive for delivery.',
      'Do not include credentials, local runtime secrets, or unrelated workspace files.',
    ],
    verification: [
      'Write a non-empty zip archive at result/exports/project_metadata.zip.',
    ],
  },
}

export function getExportConfig(format: ExportFormat): Readonly<ExportConfig> {
  return EXPORT_CONFIG[format]
}

export function buildExportMessage(task: ProjectTask, format: ExportFormat, options?: { workflow?: boolean; targetJournal?: string }): string {
  const cfg = EXPORT_CONFIG[format]
  const journalSpecific = format === 'paper_article' && !!options?.targetJournal
  const lines = [
    `Manual export request for ${task.id}.`,
    '',
    `Target format: ${cfg.title}`,
    `Output path: ${cfg.outputPath}`,
    `Output type: ${cfg.outputType}`,
  ]

  if (cfg.recommendedSkills.length > 0) {
    lines.push('', 'Recommended skills to inspect/use:')
    for (const skill of cfg.recommendedSkills) {
      lines.push(`- ${skill}`)
    }
  }

  lines.push('', 'Requirements:')
  if (journalSpecific) {
    lines.push(`- Target journal profile: ${options!.targetJournal}. Use the engine's journal-specific system instructions and article type; override the generic outline, not the evidence or approval safeguards.`)
    lines.push('- Treat editable DOCX as the requested manuscript draft. Report any additional submission files and formatting checks in the same deliverable, not as separate candidates.')
  }
  if (options?.workflow) {
    lines.push('- Use configuration.selected_experiment, when present, as the experiment scope. Shared attachments may contain other experiments; do not include those as selected results or execute experiments again.')
  }
  for (const requirement of cfg.requirements) {
    if (journalSpecific && requirement.startsWith('Write it in a regular journal article structure')) continue
    lines.push(`- ${options?.workflow
      ? requirement.replace(/task_plan\.json/g, 'the selected workflow record')
      : requirement}`)
  }

  lines.push('', 'Verification:')
  for (const check of cfg.verification) {
    if (journalSpecific && check.startsWith('Verify the document contains Introduction')) {
      lines.push('- Verify headings and abstract structure against the selected journal profile; do not force an extra Conclusion heading.')
      continue
    }
    lines.push(`- ${check}`)
  }

  if (options?.workflow) {
    lines.push('', 'Publish the deliverable using publish_workflow_artifact, then complete_workflow_run. Do not update the legacy plan.')
  } else lines.push(
    '',
    'After finishing export, update task_plan.json.result with output_path, output_type, summary, and sections.',
    'Set task_plan.json.result.output_path exactly to the output path above.',
  )

  return lines.join('\n')
}
