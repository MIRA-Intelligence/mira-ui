import { cn } from '@/lib/utils'
import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  type WorkflowCandidateItem,
} from '@/lib/workflowCandidates'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { WorkflowModuleType, WorkflowRun } from '@/types'

const STATUS_LABELS: Record<WorkflowRun['status'], { zh: string; en: string }> = {
  created: { zh: '待启动', en: 'Ready' },
  queued: { zh: '排队中', en: 'Queued' },
  running: { zh: '生成中', en: 'Running' },
  waiting_input: { zh: '待选择', en: 'Choose' },
  paused: { zh: '已暂停', en: 'Paused' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '失败', en: 'Failed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
}

export function WorkflowCandidateList({
  projectId,
  moduleType,
  runs,
  compact = false,
  fill = false,
  emptyText,
  onSelect,
}: {
  projectId: string
  moduleType: WorkflowModuleType
  runs: WorkflowRun[]
  compact?: boolean
  fill?: boolean
  emptyText?: string
  onSelect?: (candidate: WorkflowCandidateItem) => void
}) {
  const lang = useSettingsStore((state) => state.language)
  const selection = useWorkflowStore((state) => (
    state.selectedCandidateByProject[projectId]?.[moduleType]
  ))
  const selectedRunId = useWorkflowStore((state) => state.selectedRunByProject[projectId])
  const selectCandidate = useWorkflowStore((state) => state.selectCandidate)
  const candidates = buildWorkflowCandidates(runs, moduleType)
  const selected = resolveWorkflowCandidate(candidates, selection, selectedRunId)

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs leading-relaxed text-[var(--color-text-muted)]">
        {emptyText ?? (lang === 'zh' ? '还没有候选交付物' : 'No candidate outputs yet')}
      </div>
    )
  }

  return (
    <div className={cn(
      'space-y-2',
      fill && 'h-full min-h-0 overflow-y-auto pr-1',
      compact && !fill && 'max-h-48 overflow-y-auto pr-1',
    )}>
      {candidates.map((candidate) => {
        const active = selected?.runId === candidate.runId && selected.itemId === candidate.itemId
        return (
          <button
            key={`${candidate.runId}:${candidate.itemId}`}
            type="button"
            aria-pressed={active}
            aria-label={`${lang === 'zh' ? '选择候选项' : 'Select candidate'}: ${candidate.label}`}
            onClick={() => {
              selectCandidate(projectId, moduleType, {
                runId: candidate.runId,
                itemId: candidate.itemId,
              })
              onSelect?.(candidate)
            }}
            className={cn(
              'group w-full rounded-lg border px-3 py-2.5 text-left transition',
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-[inset_3px_0_0_var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/45 hover:bg-[var(--color-bg-hover)]',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                  : 'border-[var(--color-border)] text-transparent group-hover:border-[var(--color-accent)]/60',
              )}>
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-primary)]">
                    {candidate.label}
                  </span>
                  <span className="shrink-0 text-[9px] text-[var(--color-text-muted)]">
                    {lang === 'zh'
                      ? STATUS_LABELS[candidate.status].zh
                      : STATUS_LABELS[candidate.status].en}
                  </span>
                </span>
                {candidate.description && (
                  <span className="mt-1 line-clamp-2 block text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    {candidate.description}
                  </span>
                )}
                <span className="mt-1 block truncate font-mono text-[9px] text-[var(--color-text-muted)]/75">
                  {candidate.artifactIds.length > 0
                    ? `${candidate.artifactIds.length} artifact${candidate.artifactIds.length === 1 ? '' : 's'}`
                    : candidate.runId}
                  {!!candidate.sharedArtifactIds?.length && (
                    lang === 'zh' ? ` · ${candidate.sharedArtifactIds.length} 个共享附件`
                      : ` · ${candidate.sharedArtifactIds.length} shared`
                  )}
                </span>
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
