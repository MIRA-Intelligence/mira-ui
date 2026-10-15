import { useState } from 'react'

import { cn } from '@/lib/utils'
import { isWorkflowCandidateInteraction } from '@/lib/workflowCandidates'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { WorkflowInteraction, WorkflowRun } from '@/types'

export function WorkflowInteractionPanel({
  projectId,
  run,
}: {
  projectId: string
  run: WorkflowRun
}) {
  const interaction = run.module_data.interaction as WorkflowInteraction | undefined
  if (run.status !== 'waiting_input' || !interaction || interaction.response != null) return null
  return <InteractionForm key={`${run.run_id}:${interaction.interaction_id}`} projectId={projectId} run={run} />
}

function InteractionForm({
  projectId,
  run,
}: {
  projectId: string
  run: WorkflowRun
}) {
  const commandRun = useWorkflowStore((state) => state.commandRun)
  const candidateSelection = useWorkflowStore((state) => (
    state.selectedCandidateByProject[projectId]?.[run.module_type]
  ))
  const selectCandidate = useWorkflowStore((state) => state.selectCandidate)
  const lang = useSettingsStore((state) => state.language)
  const interaction = run.module_data.interaction as WorkflowInteraction | undefined
  const [selectedInteractionValue, setSelectedInteractionValue] = useState<string>()
  const [freeform, setFreeform] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!interaction) return null

  const choiceValue = (choice: Record<string, unknown>) => (
    choice.value ?? choice.artifact_id ?? choice.id ?? choice.label
  )
  const choiceLabel = (choice: Record<string, unknown>) => String(
    choice.label ?? choice.title ?? choice.name ?? choiceValue(choice) ?? '',
  )
  const candidateInteraction = isWorkflowCandidateInteraction(interaction)
  const confirmationInteraction = interaction.interaction_type.startsWith('approve_')
  const selectedItemId = candidateInteraction && candidateSelection?.runId === run.run_id
    ? candidateSelection.itemId
    : selectedInteractionValue
  const selectedChoice = interaction.choices.find(
    (choice) => String(choiceValue(choice)) === selectedItemId,
  )
  const revising = selectedChoice !== undefined && String(choiceValue(selectedChoice)) === 'revise'
  const buildResponse = () => {
    const schema = interaction.response_schema
    const value = selectedChoice ? choiceValue(selectedChoice) : freeform.trim()
    if (schema.type !== 'object') return value
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    const primary = required[0] ?? 'value'
    const response: Record<string, unknown> = { [primary]: value }
    const properties = schema.properties
    if (
      selectedChoice !== undefined
      && freeform.trim()
      && primary !== 'notes'
      && properties && typeof properties === 'object' && 'notes' in properties
    ) response.notes = freeform.trim()
    return response
  }
  const canSubmit = (
    selectedChoice !== undefined || (!confirmationInteraction && interaction.allow_freeform && freeform.trim().length > 0)
  ) && (!revising || freeform.trim().length > 0)

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      {!confirmationInteraction && (
        <div className="mb-2 text-[11px] font-bold text-amber-600 dark:text-amber-300">
          {lang === 'zh' ? '等待你的确认 · 回答后继续当前任务' : 'Your input is needed · answer to continue this task'}
        </div>
      )}
      {confirmationInteraction && (
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
          <span>{lang === 'zh' ? 'AI 执行确认' : 'AI execution confirmation'}</span>
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 normal-case tracking-normal">
            {lang === 'zh' ? '执行前必需' : 'Required before execution'}
          </span>
        </div>
      )}
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{interaction.title}</div>
      <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {interaction.prompt}
      </div>
      {interaction.choices.length > 0 && (
        <div className="mt-3 grid gap-2">
          {interaction.choices.map((choice, index) => {
            const value = choiceValue(choice)
            const itemId = String(value)
            const active = selectedItemId === itemId
            return (
              <button
                key={String(choice.id ?? index)}
                type="button"
                aria-pressed={active}
                disabled={pending}
                onClick={() => {
                  if (candidateInteraction) {
                    selectCandidate(projectId, run.module_type, {
                      runId: run.run_id,
                      itemId,
                    })
                  } else {
                    setSelectedInteractionValue(active ? undefined : itemId)
                  }
                }}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs',
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                )}
              >
                <span className="block">{choiceLabel(choice)}</span>
                {typeof choice.description === 'string' && choice.description && (
                  <span className="mt-1 block text-[11px] font-normal opacity-80">{choice.description}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {interaction.allow_freeform && (
        <textarea
          value={freeform}
          disabled={pending}
          maxLength={4000}
          aria-label={lang === 'zh' ? '补充说明或自定义回答' : 'Notes or custom answer'}
          onChange={(event) => setFreeform(event.target.value)}
          placeholder={revising
            ? (lang === 'zh' ? '请说明需要 AI 修改的内容' : 'Describe what the AI should revise')
            : (lang === 'zh' ? '补充说明或直接输入你的决定' : 'Add notes or enter your decision')}
          className="mt-3 min-h-20 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
      )}
      <button
        type="button"
        disabled={!canSubmit || pending}
        onClick={() => {
          const response = buildResponse()
          setPending(true)
          setError(null)
          void commandRun(projectId, run.run_id, 'submit_interaction', {
            interaction_id: interaction.interaction_id,
            response,
          }).then(() => {
            if (!wsClient.connected) return
            const conversationId = `${projectId}:run:${run.run_id}`
            const continuation = lang === 'zh'
              ? `继续执行。结构化交互 ${interaction.interaction_id} 的回答已保存。`
              : `Continue execution. The response to structured interaction ${interaction.interaction_id} is saved.`
            useAgentStore.getState().addLog(conversationId, {
              id: `interaction-${Date.now()}`,
              timestamp: new Date().toISOString(),
              content: `${interaction.title}: ${JSON.stringify(response)}`,
              type: 'response',
              metadata: { _user: true, _structured_interaction: true },
            })
            useAgentStore.getState().markSessionPending(conversationId)
            const projectState = useProjectStore.getState()
            wsClient.send({
              type: 'message',
              content: continuation,
              session_id: projectId,
              user_id: 'ui_user',
              loop_mode: 'project',
              stream: useSettingsStore.getState().streamResponses,
              mode: projectState.mode,
              agent_profile: projectState.agentProfile,
              workflow_run_id: run.run_id,
              workflow_module_type: run.module_type,
            })
          }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => setPending(false))
        }}
        className="mt-3 rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending
          ? (lang === 'zh' ? '提交中…' : 'Submitting…')
          : revising
            ? (lang === 'zh' ? '提交修改意见' : 'Request revision')
            : confirmationInteraction
              ? (lang === 'zh' ? '批准并继续' : 'Approve and continue')
              : (lang === 'zh' ? '确认并继续' : 'Confirm and continue')}
      </button>
      {error && <div className="mt-2 text-xs text-[var(--color-danger)]">{error}</div>}
    </div>
  )
}
