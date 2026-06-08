import { useEffect, useMemo, useState } from 'react'
import type { ProjectTask, PlanQuestion } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'
import { t } from '@/i18n'

type AnswerMap = Record<string, string | string[]>

function isAnswered(question: PlanQuestion, value: string | string[] | undefined): boolean {
  if (question.kind === 'multi') {
    return Array.isArray(value) && value.length > 0
  }
  return typeof value === 'string' && value.trim().length > 0
}

export function PlanView({ task }: { task: ProjectTask }) {
  const lang = useSettingsStore((s) => s.language)
  const mode = useProjectStore((s) => s.mode)
  const agentProfile = useProjectStore((s) => s.agentProfile)
  const submitPlanAnswers = useProjectStore((s) => s.submitPlanAnswers)
  const submitPlanDecision = useProjectStore((s) => s.submitPlanDecision)

  const plan = task.plan
  const phase = plan?.phase
  const planSignature = useMemo(() => {
    if (!plan) return 'none'
    return JSON.stringify({
      phase: plan.phase,
      updatedAt: plan.updatedAt,
      questions: plan.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options ?? [],
        rationale: q.rationale ?? '',
      })),
      answers: plan.answers,
      draft: plan.draft,
      feedback: plan.feedback ?? '',
    })
  }, [plan])

  const [answers, setAnswers] = useState<AnswerMap>({})
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [busy, setBusy] = useState(false)

  // Sync local answers with the latest plan and reset transient state whenever
  // the plan content changes, including a new questions round that reuses q1-q5.
  useEffect(() => {
    setAnswers(plan?.answers ?? {})
    setShowFeedback(false)
    setFeedback('')
    setBusy(false)
  }, [task.id, planSignature])

  const questions = plan?.questions ?? []
  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => isAnswered(q, answers[q.id])),
    [questions, answers],
  )

  const setSingle = (qid: string, option: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: option }))
  }
  const toggleMulti = (qid: string, option: string) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[qid]) ? (prev[qid] as string[]) : []
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option]
      return { ...prev, [qid]: next }
    })
  }
  const setText = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }))
  }

  const handleSubmitAnswers = () => {
    if (!allAnswered || busy) return
    setBusy(true)
    submitPlanAnswers(answers)
  }

  const handleApprove = () => {
    if (busy) return
    setBusy(true)
    submitPlanDecision('approve')
  }

  const handleRequestChanges = () => {
    if (busy) return
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    setBusy(true)
    submitPlanDecision('revise', feedback.trim())
  }

  const handleStartPlan = () => {
    useAgentStore.getState().addLog(task.id, {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: '/plan',
      type: 'response',
      metadata: { _user: true },
    })
    wsClient.send({
      type: 'message',
      content: '/plan',
      session_id: task.id,
      user_id: 'ui_user',
      loop_mode: 'project',
      mode: task.runMode ?? mode,
      agent_profile: task.agentProfile ?? agentProfile,
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {t('plan', lang)}
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          {t('planSubtitle', lang)}
        </p>

        {/* Empty state — plan mode has not started yet */}
        {!plan && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-3xl mb-3">🗺️</div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              {t('planEmptyTitle', lang)}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed mb-4">
              {t('planEmptyHint', lang)}
            </p>
            <button
              type="button"
              onClick={handleStartPlan}
              className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors"
            >
              {t('planStart', lang)}
            </button>
          </div>
        )}

        {/* Phase: questions */}
        {plan && phase === 'questions' && (
          <div className="space-y-4">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">
              {t('planQuestionsTitle', lang)}
            </h3>
            {questions.map((q, idx) => {
              const value = answers[q.id]
              return (
                <div
                  key={q.id}
                  className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
                >
                  <p className="text-sm text-[var(--color-text-primary)] font-medium mb-1 flex gap-2">
                    <span className="text-[11px] font-mono text-[var(--color-text-muted)] mt-0.5">
                      {idx + 1}.
                    </span>
                    <span>{q.prompt}</span>
                  </p>
                  {q.rationale && (
                    <p className="text-xs text-[var(--color-text-muted)] mb-2 pl-5 leading-relaxed">
                      {q.rationale}
                    </p>
                  )}

                  {q.kind === 'text' && (
                    <textarea
                      value={typeof value === 'string' ? value : ''}
                      onChange={(e) => setText(q.id, e.target.value)}
                      placeholder={t('planTextPlaceholder', lang)}
                      rows={2}
                      className="w-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-y"
                    />
                  )}

                  {(q.kind === 'single' || q.kind === 'multi') && (
                    <>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 pl-5">
                        {q.kind === 'single' ? t('planChooseOne', lang) : t('planChooseMany', lang)}
                      </p>
                      <div className="flex flex-wrap gap-2 pl-5">
                        {(q.options ?? []).map((option) => {
                          const selected =
                            q.kind === 'multi'
                              ? Array.isArray(value) && value.includes(option)
                              : value === option
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() =>
                                q.kind === 'multi'
                                  ? toggleMulti(q.id, option)
                                  : setSingle(q.id, option)
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                                selected
                                  ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/40'
                                  : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'
                              }`}
                            >
                              {option}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSubmitAnswers}
                disabled={!allAnswered || busy}
                className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors disabled:opacity-50"
              >
                {busy ? t('planWaiting', lang) : t('planSubmitAnswers', lang)}
              </button>
              {!allAnswered && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('planAnswerAllHint', lang)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Phase: draft */}
        {plan && phase === 'draft' && plan.draft && (
          <div className="space-y-4">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">
              {t('planDraftTitle', lang)}
            </h3>

            {plan.draft.summary && (
              <div className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                {plan.draft.summary}
              </div>
            )}

            {plan.draft.experiments.length > 0 && (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2">
                  {t('planExperimentsLabel', lang)} ({plan.draft.experiments.length})
                </h4>
                <div className="space-y-2">
                  {plan.draft.experiments.map((exp, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
                    >
                      <p className="text-sm font-medium text-[var(--color-text-primary)] flex gap-2">
                        <span className="text-[11px] font-mono text-[var(--color-text-muted)] mt-0.5">
                          {i + 1}.
                        </span>
                        <span>{exp.title}</span>
                      </p>
                      {exp.hypothesis && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 pl-5 leading-relaxed">
                          <span className="text-[var(--color-text-muted)]">
                            {t('planHypothesisLabel', lang)}:
                          </span>{' '}
                          {exp.hypothesis}
                        </p>
                      )}
                      {exp.method && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 pl-5 leading-relaxed">
                          <span className="text-[var(--color-text-muted)]">
                            {t('planMethodLabel', lang)}:
                          </span>{' '}
                          {exp.method}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showFeedback && (
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t('planFeedbackPlaceholder', lang)}
                rows={3}
                className="w-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)] resize-y"
              />
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleApprove}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent)]/80 transition-colors disabled:opacity-50"
              >
                {busy ? t('planWaiting', lang) : t('planApprove', lang)}
              </button>
              <button
                type="button"
                onClick={handleRequestChanges}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
              >
                {showFeedback ? t('planSendChanges', lang) : t('planRequestChanges', lang)}
              </button>
            </div>
          </div>
        )}

        {/* Phase: approved */}
        {plan && phase === 'approved' && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-3xl mb-3">✅</div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              {t('planApprovedTitle', lang)}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] max-w-xs leading-relaxed">
              {t('planApprovedHint', lang)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
