import { cn } from '@/lib/utils'
import type { Step, ResearchData, PaperReference } from '@/types'
import { StepItem } from '../task/StepItem'

interface ResearchViewProps {
  steps: Step[]
  data?: ResearchData
}

function PaperCard({ paper }: { paper: PaperReference }) {
  const hasLink = paper.doi || paper.url
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3.5 flex flex-col gap-2 hover:border-[var(--color-accent)]/40 transition-colors">
      <div className="flex items-start gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-[var(--color-accent)]">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] leading-snug line-clamp-2">
            {hasLink ? (
              <a
                href={paper.doi ? `https://doi.org/${paper.doi}` : paper.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--color-accent)] transition-colors"
              >
                {paper.title}
              </a>
            ) : (
              paper.title
            )}
          </h4>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
            {paper.authors}
            {paper.year && <span> · {paper.year}</span>}
            {paper.venue && <span> · {paper.venue}</span>}
          </p>
        </div>
      </div>

      {paper.abstract && (
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed line-clamp-3">
          {paper.abstract}
        </p>
      )}

      {paper.relevance && (
        <div className="flex items-start gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--color-accent)] uppercase shrink-0 mt-px">
            Relevance
          </span>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            {paper.relevance}
          </p>
        </div>
      )}

      {paper.tags && paper.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {paper.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ResearchView({ steps, data }: ResearchViewProps) {
  const hasPapers = data?.papers && data.papers.length > 0
  const hasGaps = data?.gaps && data.gaps.length > 0
  const hasFindings = data?.key_findings && data.key_findings.length > 0
  const hasSummary = data?.summary && data.summary.trim().length > 0

  return (
    <div className="h-full overflow-y-auto">
      {/* Papers grid */}
      {hasPapers && (
        <section className="p-4 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
              Literature ({data!.papers!.length} papers)
            </h3>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {data!.papers!.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
        </section>
      )}

      {/* Key findings */}
      {hasFindings && (
        <section className="px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-2">
            Key Findings
          </h3>
          <ul className="space-y-1.5">
            {data!.key_findings!.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
                <span className="text-[var(--color-accent)] mt-1 shrink-0">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Research gaps */}
      {hasGaps && (
        <section className="px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-2">
            Identified Gaps
          </h3>
          <ul className="space-y-1.5">
            {data!.gaps!.map((g, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
                <span className="text-amber-400 mt-1 shrink-0">△</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Summary */}
      {hasSummary && (
        <section className="px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-2">
            Summary
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
            {data!.summary}
          </p>
        </section>
      )}

      {/* Steps for this stage */}
      {steps.length > 0 && (
        <section className={cn('px-4 py-3', (hasPapers || hasFindings || hasGaps) && 'border-t border-[var(--color-border)]')}>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-2">
            Steps
          </h3>
          {steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
        </section>
      )}

      {/* Empty state */}
      {!hasPapers && !hasFindings && !hasGaps && steps.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="text-xs">Agent is conducting research...</span>
        </div>
      )}
    </div>
  )
}
