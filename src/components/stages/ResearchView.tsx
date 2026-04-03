import type { ResearchData, Reference } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

function ReferenceCard({ reference: r, lang }: { reference: Reference; lang: ReturnType<typeof useSettingsStore.getState>['language'] }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/30 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0 mt-0.5">[{r.id}]</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] leading-snug">
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)] transition-colors">
                {r.title}
              </a>
            ) : r.title}
          </h4>
          {(r.authors || r.year || r.venue) && (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              {[r.authors, r.venue, r.year].filter(Boolean).join(' · ')}
            </p>
          )}
          {r.summary && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">{r.summary}</p>
          )}
          {r.relevance && (
            <p className="text-[11px] text-[var(--color-accent)] mt-1 italic">
              {t('relevance', lang)}: {r.relevance}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function ResearchView({ data, coreQuestion }: {
  data: ResearchData
  coreQuestion?: string
}) {
  const lang = useSettingsStore((s) => s.language)
  const hasContent = data.references.length > 0 || data.notes.length > 0 || data.survey

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {t('researchLiterature', lang)}
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          {t('researchSubtitle', lang)}
        </p>

        {coreQuestion && (
          <div className="mb-5 p-3 rounded-lg bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-semibold">
              {t('researchQuestion', lang)}
            </span>
            <p className="text-sm text-[var(--color-text-primary)] mt-1 leading-relaxed">
              {coreQuestion}
            </p>
          </div>
        )}

        {!hasContent && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-3xl mb-3">📚</div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              {t('noResearchData', lang)}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
              {t('noResearchDataHint', lang)}
            </p>
          </div>
        )}

        {/* Survey overview */}
        {data.survey && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📋</span> {t('survey', lang)}
            </h3>
            <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-[var(--color-bg-secondary)]">
              {data.survey}
            </div>
          </div>
        )}

        {/* References */}
        {data.references.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📄</span> {t('references', lang)}
              <span className="text-[10px] font-mono bg-[var(--color-bg-tertiary)] px-1 py-px rounded">
                {data.references.length}
              </span>
            </h3>
            <div className="space-y-2">
              {data.references.map((r) => (
                <ReferenceCard key={r.id} reference={r} lang={lang} />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {data.notes.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📝</span> {t('notes', lang)}
            </h3>
            <ul className="space-y-1.5">
              {data.notes.map((note, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span className="text-[var(--color-accent)] shrink-0 mt-0.5">•</span>
                  <span className="text-[var(--color-text-primary)]">{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
