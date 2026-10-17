import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  workflowRunsForUpstreamCandidate,
  type WorkflowCandidateItem,
} from '@/lib/workflowCandidates'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { StartableModuleType, WorkflowModuleType, WorkflowRun } from '@/types'
import { WorkflowCandidateList } from './WorkflowCandidateList'

export const PIPELINE_STAGES: Array<{
  moduleType: StartableModuleType
  icon: string
  step: number
  zh: string
  en: string
  zhHint: string
  enHint: string
  next?: Extract<WorkflowModuleType, 'experiment' | 'delivery'>
}> = [
  {
    moduleType: 'initiation',
    icon: '📚',
    step: 1,
    zh: '调研',
    en: 'Research',
    zhHint: '方向、证据与调研结论',
    enHint: 'Directions, evidence, and findings',
    next: 'experiment',
  },
  {
    moduleType: 'experiment',
    icon: '🔬',
    step: 2,
    zh: '实验',
    en: 'Experiment',
    zhHint: '方案、实验结果与可复用产物',
    enHint: 'Plans, results, and reusable artifacts',
    next: 'delivery',
  },
  {
    moduleType: 'delivery',
    icon: '📝',
    step: 3,
    zh: '结果交付',
    en: 'Delivery',
    zhHint: '报告、论文、演示与数据包',
    enHint: 'Reports, papers, decks, and packages',
  },
]

export function PipelineOverview({
  projectId,
  runs,
  disabled,
  onStartModule,
  onContinue,
  onOpen,
}: {
  projectId: string
  runs: WorkflowRun[]
  disabled?: boolean
  onStartModule: (moduleType: WorkflowModuleType) => void
  onContinue: (moduleType: WorkflowModuleType, candidate: WorkflowCandidateItem) => void
  onOpen: (candidate: WorkflowCandidateItem) => void
}) {
  const lang = useSettingsStore((state) => state.language)
  const selections = useWorkflowStore((state) => state.selectedCandidateByProject[projectId])
  const selectedRunId = useWorkflowStore((state) => state.selectedRunByProject[projectId])
  const researchCandidates = buildWorkflowCandidates(runs, 'initiation')
  const selectedResearch = resolveWorkflowCandidate(
    researchCandidates,
    selections?.initiation,
    selectedRunId,
  )
  const experimentRuns = selectedResearch
    ? workflowRunsForUpstreamCandidate(runs, 'experiment', selectedResearch)
    : runs.filter((run) => (
        run.module_type === 'experiment' && !run.module_data.parent_run_id
      ))
  const experimentCandidates = buildWorkflowCandidates(experimentRuns, 'experiment')
  const selectedExperiment = resolveWorkflowCandidate(
    experimentCandidates,
    selections?.experiment,
    selectedRunId,
  )
  const deliveryRuns = selectedExperiment
    ? workflowRunsForUpstreamCandidate(runs, 'delivery', selectedExperiment)
    : runs.filter((run) => (
        run.module_type === 'delivery' && !run.module_data.parent_run_id
      ))
  const deliveryCandidates = buildWorkflowCandidates(deliveryRuns, 'delivery')
  const selectedDelivery = resolveWorkflowCandidate(
    deliveryCandidates,
    selections?.delivery,
    selectedRunId,
  )
  const stageViews = {
    initiation: { runs, candidates: researchCandidates, selected: selectedResearch },
    experiment: { runs: experimentRuns, candidates: experimentCandidates, selected: selectedExperiment },
    delivery: { runs: deliveryRuns, candidates: deliveryCandidates, selected: selectedDelivery },
  }

  const emptyTextFor = (moduleType: typeof PIPELINE_STAGES[number]['moduleType']) => {
    if (moduleType === 'initiation') {
      return lang === 'zh' ? '尚无调研候选，先启动本阶段。' : 'No research candidates yet. Start this stage first.'
    }
    if (moduleType === 'experiment') {
      if (!selectedResearch) {
        return lang === 'zh' ? '选择一个调研 item 后加载实验分支。' : 'Select a research item to load its experiment branch.'
      }
      return lang === 'zh' ? '此调研 item 尚无实验分支。' : 'This research item has no experiment branch yet.'
    }
    if (!selectedExperiment) {
      return lang === 'zh' ? '选择一个实验 item 后加载交付分支。' : 'Select an experiment item to load its delivery branch.'
    }
    return lang === 'zh' ? '此实验 item 尚无交付分支。' : 'This experiment item has no delivery branch yet.'
  }

  return (
    <section
      aria-labelledby="pipeline-overview-title"
      className="flex min-h-[32rem] flex-1 flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 shadow-sm xl:min-h-0 xl:overflow-hidden"
    >
      <div className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {lang === 'zh' ? '一条 Pipeline · 三个阶段' : 'One pipeline · three stages'}
          </div>
          <h2 id="pipeline-overview-title" className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
            {lang === 'zh' ? '项目总览' : 'Project overview'}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            {lang === 'zh'
              ? '在任一阶段选择候选交付物；改变上游选择后，从该候选继续会创建新的下游分支，旧结果仍保留。'
              : 'Select a candidate output at any stage. Changing an upstream choice and continuing creates a new downstream branch while preserving earlier results.'}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-3">
        {PIPELINE_STAGES.map((stage, index) => {
          const { runs: stageRuns, candidates, selected } = stageViews[stage.moduleType]
          const canContinue = selected?.status === 'completed'
          const continueHint = !selected
            ? (lang === 'zh' ? '请先选择一个候选 item' : 'Select a candidate item first')
            : !canContinue
              ? (lang === 'zh' ? '候选所属运行完成后才能继续' : 'The candidate run must be completed first')
              : undefined
          return (
            <div key={stage.moduleType} className="relative flex min-h-[28rem] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3.5 xl:min-h-0">
              {index < PIPELINE_STAGES.length - 1 && (
                <div className="absolute -right-3 top-8 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-accent)] xl:flex">
                  →
                </div>
              )}
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-tertiary)] text-lg">
                  {stage.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {stage.step}. {lang === 'zh' ? stage.zh : stage.en}
                    </h3>
                    <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)]">
                      {candidates.length} {lang === 'zh' ? '个候选' : 'candidates'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                    {lang === 'zh' ? stage.zhHint : stage.enHint}
                  </p>
                </div>
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-hidden">
                <WorkflowCandidateList
                  projectId={projectId}
                  moduleType={stage.moduleType}
                  runs={stageRuns}
                  compact
                  fill
                  emptyText={emptyTextFor(stage.moduleType)}
                />
              </div>

              <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
                {selected && (
                  <button
                    type="button"
                    onClick={() => onOpen(selected)}
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                  >
                    {lang === 'zh' ? '打开所选' : 'Open selected'}
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  aria-label={`${lang === 'zh' ? stage.zh : stage.en} ${lang === 'zh' ? '启动模块' : 'Start module'}`}
                  disabled={disabled}
                  onClick={() => onStartModule(stage.moduleType)}
                  className="rounded-md border border-[var(--color-accent)]/35 px-2.5 py-1.5 text-[10px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/8 disabled:opacity-50"
                >
                  {candidates.length > 0
                    ? (lang === 'zh' ? '+ 新候选' : '+ New')
                    : (lang === 'zh' ? '启动阶段' : 'Start stage')}
                </button>
                {stage.next && (
                  <button
                    type="button"
                    disabled={disabled || !canContinue}
                    title={continueHint}
                    onClick={() => {
                      if (selected && canContinue) onContinue(stage.next!, selected)
                    }}
                    className="rounded-md bg-[var(--color-accent)] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {lang === 'zh'
                      ? `用此候选继续${PIPELINE_STAGES.find((item) => item.moduleType === stage.next)?.zh ?? ''} →`
                      : `Continue to ${PIPELINE_STAGES.find((item) => item.moduleType === stage.next)?.en ?? ''} →`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
