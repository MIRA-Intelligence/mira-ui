import { describe, expect, it } from 'vitest'

import type { WorkflowRun } from '@/types'
import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  workflowRunsForUpstreamCandidate,
} from './workflowCandidates'

function makeRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'run-1',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Research run',
    status: 'completed',
    revision: 1,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
    inputs: [],
    outputs: ['research-bundle'],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:run-1',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: {},
    ...overrides,
  }
}

describe('workflowCandidates', () => {
  it('groups a selected presentation and its editable source into one delivery', () => {
    const run = makeRun({ module_type: 'delivery', outputs: ['pdf', 'pptx'],
      module_data: { delivery_format: 'presentation', output_path: 'result/exports/presentation.pdf' },
    })
    const candidates = buildWorkflowCandidates([run], 'delivery')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      itemId: run.run_id, label: 'presentation.pdf', artifactIds: ['pdf', 'pptx'], status: 'completed',
    })
  })

  it.each(['experiment_report', 'paper_article', 'presentation', 'metadata'])(
    'keeps %s delivery packages separate across runs and restores legacy file selections', (format) => {
      const first = makeRun({ module_type: 'delivery', outputs: ['main', 'source'],
        module_data: { delivery_format: format },
      })
      const second = makeRun({ ...first, run_id: 'run-2', outputs: ['other'] })
      const candidates = buildWorkflowCandidates([first, second], 'delivery')
      expect(candidates).toHaveLength(2)
      expect(candidates.map((item) => item.artifactIds)).toEqual([['main', 'source'], ['other']])
      expect(resolveWorkflowCandidate(candidates, { runId: first.run_id, itemId: 'source' }, second.run_id)?.itemId)
        .toBe(first.run_id)
      expect(resolveWorkflowCandidate(candidates, null)).toBeNull()
    },
  )

  it('does not invent completed delivery outputs or group unconfigured legacy deliveries', () => {
    const pending = makeRun({ module_type: 'delivery', status: 'waiting_input', outputs: [],
      module_data: { delivery_format: 'presentation' },
    })
    expect(buildWorkflowCandidates([pending], 'delivery')[0]).toMatchObject({
      status: 'waiting_input', artifactIds: [],
    })
    const legacy = makeRun({ module_type: 'delivery', outputs: ['one', 'two'] })
    expect(buildWorkflowCandidates([legacy], 'delivery').map((item) => item.itemId)).toEqual(['one', 'two'])
  })

  it('groups two registered experiments into two candidates, not four output files', () => {
    const run = makeRun({ module_type: 'experiment', outputs: ['report', 'bundle', 'figure', 'csv'],
      module_data: { experiments: [
        { id: 'Exp001', title: 'Mechanism', status: 'completed', conclusion: 'Supported with limits' },
        { id: 'Exp002', title: 'Negative control', status: 'completed', conclusion: 'Partially supported' },
      ] },
    })
    const candidates = buildWorkflowCandidates([run], 'experiment')
    expect(candidates.map((item) => item.itemId)).toEqual(['Exp001', 'Exp002'])
    expect(candidates.map((item) => item.label)).toEqual(['Exp001 · Mechanism', 'Exp002 · Negative control'])
    expect(candidates[1].description).toBe('Partially supported')
    expect(candidates[1].artifactIds).toEqual(run.outputs)
  })

  it('keeps owned files separate, retains shared attachments and uses experiment status', () => {
    const run = makeRun({ module_type: 'experiment', outputs: ['first', 'second', 'shared'],
      module_data: { experiments: [
        { id: 'Exp001', title: 'First', status: 'completed', evidence_refs: [{ ref_id: 'first' }] },
        { id: 'Exp002', title: 'Second', status: 'failed', evidence_refs: [{ artifact_id: 'second' }] },
      ] },
    })
    const [first, second] = buildWorkflowCandidates([run], 'experiment')
    expect(first.artifactIds).toEqual(['first', 'shared'])
    expect(second.artifactIds).toEqual(['second', 'shared'])
    expect(second.status).toBe('failed')
  })

  it('distinguishes downstream branches even when experiments share all attachments', () => {
    const source = makeRun({ module_type: 'experiment', outputs: ['shared'], module_data: { experiments: [
      { id: 'Exp001', title: 'First', status: 'completed' },
      { id: 'Exp002', title: 'Second', status: 'completed' },
    ] } })
    const delivery = makeRun({ run_id: 'delivery', module_type: 'delivery', inputs: [{ artifact_id: 'shared' }],
      module_data: { parent_run_id: source.run_id, upstream_selection: { run_id: source.run_id, item_id: 'Exp002' } },
    })
    const [first, second] = buildWorkflowCandidates([source], 'experiment')
    expect(workflowRunsForUpstreamCandidate([source, delivery], 'delivery', first)).toEqual([])
    expect(workflowRunsForUpstreamCandidate([source, delivery], 'delivery', second)).toEqual([delivery])
  })

  it('keeps a resolved candidate across repeated clarification and conflict forms', () => {
    const saved = {
      interaction_id: 'chosen', interaction_type: 'choose_direction', title: 'Direction',
      prompt: 'Which direction?', response_schema: { type: 'object', required: ['selection'] },
      choices: [{ id: 'a', label: 'Direction A' }, { id: 'b', label: 'Direction B' }],
      allow_freeform: true, response: { selection: 'b' },
    }
    for (const type of ['clarify_requirements', 'resolve_conflict', 'custom_question']) {
      const run = makeRun({ module_data: {
        interaction_history: [saved],
        interaction: { ...saved, interaction_id: type, interaction_type: type,
          choices: [{ id: 'scope', label: 'Use existing data' }], response: { selection: 'scope' } },
      } })
      const candidates = buildWorkflowCandidates([run], 'initiation')
      expect(candidates.map((item) => item.itemId)).toEqual(['a', 'b'])
      expect(resolveWorkflowCandidate(candidates, undefined)?.itemId).toBe('b')
    }
  })

  it('deduplicates structured directions and interaction choices while retaining the saved choice', () => {
    const run = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A', rationale: 'Fast.' },
            { id: 'direction-b', title: 'Direction B', rationale: 'High upside.' },
          ],
        },
        interaction: {
          interaction_id: 'choose-direction',
          interaction_type: 'choose_direction',
          title: 'Choose direction',
          prompt: 'Choose one',
          response_schema: { type: 'object', required: ['direction_id'] },
          choices: [
            { id: 'direction-a', label: 'Direction A' },
            { id: 'direction-b', label: 'Direction B' },
          ],
          allow_freeform: false,
          response: { direction_id: 'direction-b' },
        },
      },
    })

    const candidates = buildWorkflowCandidates([run], 'initiation')

    expect(candidates.map((candidate) => candidate.itemId)).toEqual(['direction-a', 'direction-b'])
    expect(resolveWorkflowCandidate(candidates, undefined, 'run-1')?.itemId).toBe('direction-b')
  })

  it('uses a selected artifact instead of forwarding every output', () => {
    const run = makeRun({
      module_type: 'experiment',
      outputs: ['metric-a', 'metric-b'],
      module_data: { completion_summary: 'Two experiment outcomes' },
    })
    const candidates = buildWorkflowCandidates([run], 'experiment')
    const selected = resolveWorkflowCandidate(candidates, {
      runId: 'run-1',
      itemId: 'metric-b',
    })

    expect(selected?.artifactIds).toEqual(['metric-b'])
  })

  it('does not expose approval controls as deliverable candidates', () => {
    const run = makeRun({
      status: 'waiting_input',
      module_data: {
        interaction: {
          interaction_id: 'research-approval',
          interaction_type: 'approve_research_scope',
          title: 'Approve research brief',
          prompt: 'Approve this scope?',
          response_schema: { type: 'object', required: ['selection'] },
          choices: [
            { id: 'approve', label: 'Approve', value: 'approve' },
            { id: 'revise', label: 'Revise', value: 'revise' },
          ],
          allow_freeform: true,
        },
      },
    })

    expect(buildWorkflowCandidates([run], 'initiation').map((item) => item.itemId)).toEqual([
      'research-bundle',
    ])
  })

  it('loads only the downstream Runs linked to the selected item', () => {
    const researchRun = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A' },
            { id: 'direction-b', title: 'Direction B' },
          ],
        },
      },
    })
    const experimentA = makeRun({
      run_id: 'experiment-a',
      module_type: 'experiment',
      outputs: ['result-a'],
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: {
        parent_run_id: 'run-1',
        upstream_selection: { run_id: 'run-1', item_id: 'direction-a' },
      },
    })
    const experimentB = makeRun({
      run_id: 'experiment-b',
      module_type: 'experiment',
      outputs: ['result-b'],
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: {
        parent_run_id: 'run-1',
        upstream_selection: { run_id: 'run-1', item_id: 'direction-b' },
      },
    })
    const runs = [researchRun, experimentA, experimentB]
    const directionB = buildWorkflowCandidates(runs, 'initiation')[1]

    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionB).map(
      (run) => run.run_id,
    )).toEqual(['experiment-b'])
  })

  it('recovers a legacy parent-only branch only for the saved source choice', () => {
    const researchRun = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A' },
            { id: 'direction-b', title: 'Direction B' },
          ],
        },
        interaction: {
          interaction_id: 'direction',
          interaction_type: 'choose_direction',
          title: 'Choose',
          prompt: 'Choose',
          response_schema: { type: 'object', required: ['direction_id'] },
          choices: [],
          allow_freeform: false,
          response: { direction_id: 'direction-a' },
        },
      },
    })
    const legacyExperiment = makeRun({
      run_id: 'legacy-experiment',
      module_type: 'experiment',
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: { parent_run_id: 'run-1' },
    })
    const runs = [researchRun, legacyExperiment]
    const [directionA, directionB] = buildWorkflowCandidates(runs, 'initiation')

    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionA)).toEqual([legacyExperiment])
    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionB)).toEqual([])
  })
})
