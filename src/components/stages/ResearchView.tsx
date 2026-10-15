import type { InitiationResearchResult, ResearchData, Reference } from '@/types'
import { LogEntry as AgentLogEntryView } from '@/components/agent/LogEntry'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { t } from '@/i18n'

const LITERATURE_SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  google_scholar: 'Google Scholar',
  arxiv: 'arXiv',
  semantic_scholar: 'Semantic Scholar',
  crossref: 'Crossref',
  europe_pmc: 'Europe PMC',
}

function ReferenceCard({ reference: r, lang }: { reference: Reference; lang: ReturnType<typeof useSettingsStore.getState>['language'] }) {
  const legacyDoiMarker = ' (DOI: '
  const hasLegacyCombinedUrl = Boolean(
    r.url?.includes(legacyDoiMarker) && r.url.endsWith(')'),
  )
  const cleanUrl = hasLegacyCombinedUrl ? r.url?.split(legacyDoiMarker, 1)[0] : r.url
  const cleanDoi = r.doi ?? (
    hasLegacyCombinedUrl
      ? r.url?.slice((r.url?.indexOf(legacyDoiMarker) ?? -legacyDoiMarker.length) + legacyDoiMarker.length, -1)
      : undefined
  )
  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/30 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0 mt-0.5">[{r.id}]</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] leading-snug">
            {cleanUrl ? (
              <a href={cleanUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)] transition-colors">
                {r.title}
              </a>
            ) : r.title}
          </h4>
          {(r.authors || r.year || r.source || r.venue) && (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              {[r.authors, r.source, r.venue, r.year].filter(Boolean).join(' · ')}
            </p>
          )}
          {cleanDoi && (
            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
              DOI: {cleanDoi}
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
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const selectedRunId = useWorkflowStore((state) => (
    projectId ? state.selectedRunByProject[projectId] : null
  ))
  const selectedRun = useWorkflowStore((state) => (
    projectId && selectedRunId
      ? state.snapshots[projectId]?.runs.find((run) => run.run_id === selectedRunId)
      : undefined
  ))
  const conversationId = projectId && selectedRun?.module_type === 'initiation'
    ? `${projectId}:run:${selectedRun.run_id}`
    : null
  const logsByProject = useAgentStore((state) => state.logsByProject)
  const runLogs = conversationId ? (logsByProject[conversationId] ?? []) : []
  const researchEntries = runLogs.filter(
    (entry) => entry.type === 'response' && entry.metadata?._user !== true,
  )
  const literature = selectedRun?.module_type === 'initiation'
    ? selectedRun.module_data.literature_review as {
      enabled?: boolean
      sources?: string[]
    } | undefined
    : undefined
  const moduleResearchActive = selectedRun?.module_type === 'initiation'
  const literatureEnabled = literature?.enabled !== false
  const sourceLabels = (literature?.sources ?? []).map(
    (source) => LITERATURE_SOURCE_LABELS[source] ?? source,
  )
  const userReferences = moduleResearchActive
    && typeof selectedRun.module_data.references === 'string'
    ? selectedRun.module_data.references
    : ''
  const rawResearchResult = moduleResearchActive
    ? selectedRun.module_data.research_result
    : undefined
  const structuredResult = (
    rawResearchResult
    && typeof rawResearchResult === 'object'
    && (rawResearchResult as { schema_version?: unknown }).schema_version === 1
    && Array.isArray((rawResearchResult as { references?: unknown }).references)
    && Array.isArray((rawResearchResult as { notes?: unknown }).notes)
    && Array.isArray((rawResearchResult as { gaps?: unknown }).gaps)
    && Array.isArray((rawResearchResult as { directions?: unknown }).directions)
  ) ? rawResearchResult as InitiationResearchResult : undefined
  const searchRecords = structuredResult && Array.isArray(structuredResult.searches)
    ? structuredResult.searches
    : []
  const displayData: ResearchData = structuredResult
    ? {
        survey: structuredResult.survey,
        references: structuredResult.references,
        notes: structuredResult.notes,
      }
    : data
  const hasContent = Boolean(
    displayData.references.length > 0
    || displayData.notes.length > 0
    || displayData.survey
    || moduleResearchActive,
  )

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

        {moduleResearchActive && (
          <>
            <div className="mb-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                <span>⚙️</span>
                {lang === 'zh' ? '本次文献调研配置' : 'Literature research configuration'}
              </h3>
              <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
                <div>
                  <span className="text-[var(--color-text-muted)]">
                    {lang === 'zh' ? '外部文献调研：' : 'External literature research: '}
                  </span>
                  {literatureEnabled
                    ? (lang === 'zh' ? '已启用' : 'Enabled')
                    : (lang === 'zh' ? '已停用' : 'Disabled')}
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">
                    {lang === 'zh' ? '指定来源：' : 'Selected sources: '}
                  </span>
                  {literatureEnabled ? (sourceLabels.join(', ') || '—') : '—'}
                </div>
                {userReferences && (
                  <div className="whitespace-pre-wrap">
                    <span className="text-[var(--color-text-muted)]">
                      {lang === 'zh' ? '用户参考文献：' : 'User references: '}
                    </span>
                    {userReferences}
                  </div>
                )}
              </div>
            </div>

          </>
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
        {displayData.survey && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📋</span> {t('survey', lang)}
            </h3>
            <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-[var(--color-bg-secondary)]">
              {displayData.survey}
            </div>
          </div>
        )}

        {/* References */}
        {displayData.references.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📄</span> {t('references', lang)}
              <span className="text-[10px] font-mono bg-[var(--color-bg-tertiary)] px-1 py-px rounded">
                {displayData.references.length}
              </span>
            </h3>
            <div className="space-y-2">
              {displayData.references.map((r) => (
                <ReferenceCard key={r.id} reference={r} lang={lang} />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {displayData.notes.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
              <span>📝</span> {t('notes', lang)}
            </h3>
            <ul className="space-y-1.5">
              {displayData.notes.map((note, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span className="text-[var(--color-accent)] shrink-0 mt-0.5">•</span>
                  <span className="text-[var(--color-text-primary)]">{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {searchRecords.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              <span>🔍</span>
              {lang === 'zh' ? '检索证据' : 'Search evidence'}
            </h3>
            <div className="space-y-2">
              {searchRecords.map((search, index) => (
                <div
                  key={`${search.source}-${search.searched_at}-${index}`}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--color-text-primary)]">
                      {LITERATURE_SOURCE_LABELS[search.source] ?? search.source}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {search.status === 'completed'
                        ? `${search.result_count} ${lang === 'zh' ? '条结果' : 'results'}`
                        : search.status}
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {search.query}
                  </p>
                  {search.evidence_urls.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                      {search.evidence_urls.slice(0, 5).map((url, evidenceIndex) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[var(--color-accent)] hover:underline"
                        >
                          {lang === 'zh' ? `证据 ${evidenceIndex + 1}` : `Evidence ${evidenceIndex + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                  {search.detail && (
                    <p className="mt-1.5 text-[11px] text-amber-600">{search.detail}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {structuredResult && structuredResult.gaps.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              <span>🧩</span>
              {lang === 'zh' ? '研究空白' : 'Research gaps'}
            </h3>
            <ul className="space-y-1.5">
              {structuredResult.gaps.map((gap, index) => (
                <li key={`${index}-${gap}`} className="flex gap-2 text-sm leading-relaxed">
                  <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                  <span className="text-[var(--color-text-primary)]">{gap}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {structuredResult && structuredResult.directions.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              <span>🧭</span>
              {lang === 'zh' ? '候选研究方向' : 'Candidate research directions'}
            </h3>
            <div className="space-y-2">
              {structuredResult.directions.map((direction) => (
                <div
                  key={direction.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3"
                >
                  <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
                    {direction.title}
                  </h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {direction.rationale}
                  </p>
                  {direction.tradeoffs && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                      {lang === 'zh' ? '权衡：' : 'Trade-offs: '}{direction.tradeoffs}
                    </p>
                  )}
                  {direction.next_step && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-accent)]">
                      {lang === 'zh' ? '下一步：' : 'Next step: '}{direction.next_step}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {moduleResearchActive && (
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                <span>🔎</span>
                {lang === 'zh' ? '过程审计记录' : 'Process audit log'}
              </h3>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {lang === 'zh' ? '与右侧对话实时同步' : 'Live from the Run conversation'}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              {researchEntries.length === 0 ? (
                <div className="p-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {lang === 'zh'
                    ? 'Mira 的文献检索过程、证据整理和调研结论会在这里实时显示，供你核对和审计。'
                    : 'Mira’s literature search, evidence synthesis, and findings will appear here for review and audit.'}
                </div>
              ) : researchEntries.map((entry) => (
                <div key={entry.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <AgentLogEntryView entry={entry} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
