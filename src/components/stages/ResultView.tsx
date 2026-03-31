import type { ResultData, ProjectTask } from '@/types'
import { HarnessPanel } from '@/components/harness/HarnessPanel'

export function ResultView({ data, task }: { data: ResultData; task: ProjectTask }) {
  const hasContent = data.summary || (data.sections?.length ?? 0) > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          Result
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          Final output and deliverables for this project
        </p>

        {!hasContent && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-3xl mb-3">📝</div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              No results yet
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
              Results will appear here once the agent completes experiments and generates the final deliverable ({task.coreQuestion ? 'based on your research question' : 'paper, report, or analysis'}).
            </p>
          </div>
        )}

        {/* Output file */}
        {data.outputPath && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center gap-3">
            <span className="text-lg">📁</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
                Output {data.outputType ? `(${data.outputType})` : ''}
              </p>
              <p className="text-xs font-mono text-[var(--color-text-primary)] truncate mt-0.5">
                {data.outputPath}
              </p>
            </div>
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>✅</span> Summary
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
              <span>💡</span> Key Findings ({task.knowledge.length})
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

        <HarnessPanel sessionId={task.id} />
      </div>
    </div>
  )
}
