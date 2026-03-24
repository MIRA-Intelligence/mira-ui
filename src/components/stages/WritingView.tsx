import { cn } from '@/lib/utils'
import type { Step, WritingData } from '@/types'
import { StepItem } from '../task/StepItem'

interface WritingViewProps {
  steps: Step[]
  data?: WritingData
}

export function WritingView({ steps, data }: WritingViewProps) {
  const hasOutline = data?.outline && data.outline.length > 0

  return (
    <div className="h-full overflow-y-auto">
      {/* Word count progress */}
      {data?.target_words && (
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Document
          </h3>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {(data.total_words ?? 0).toLocaleString()} / {data.target_words.toLocaleString()} words
          </span>
          <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden max-w-[200px]">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, ((data.total_words ?? 0) / data.target_words) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Document outline */}
      {hasOutline && (
        <section className="p-4 pb-2">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-3">
            Outline
          </h3>
          <div className="space-y-1">
            {data!.outline!.map((section, i) => (
              <div
                key={section.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors',
                  section.status === 'completed'
                    ? 'border-[var(--color-success)]/20 bg-[var(--color-success)]/5'
                    : section.status === 'running'
                      ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]',
                )}
              >
                <span className="text-[var(--color-text-muted)] text-xs font-mono w-4 text-right shrink-0">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <span className={cn(
                    'text-sm',
                    section.status === 'completed'
                      ? 'text-[var(--color-text-secondary)]'
                      : section.status === 'running'
                        ? 'text-[var(--color-text-primary)] font-medium'
                        : 'text-[var(--color-text-muted)]',
                  )}>
                    {section.title}
                  </span>
                  {section.preview && (
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
                      {section.preview}
                    </p>
                  )}
                </div>
                {section.word_count !== undefined && (
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0">
                    {section.word_count}w
                  </span>
                )}
                {section.status === 'completed' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-success)] shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {section.status === 'running' && (
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse shrink-0" />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <section className={cn('p-4', hasOutline && 'border-t border-[var(--color-border)]')}>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase mb-2">
            Steps
          </h3>
          {steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
        </section>
      )}

      {/* Empty state */}
      {!hasOutline && steps.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="text-xs">Writing phase not started yet</span>
        </div>
      )}
    </div>
  )
}
