import { describe, expect, it } from 'vitest'

import { scopedModuleRuns } from './workflowCandidates'
import type { WorkflowRun } from '@/types'

function run(partial: Partial<WorkflowRun> & Pick<WorkflowRun, 'run_id' | 'module_type'>): WorkflowRun {
  return {
    schema_version: 1, workflow_contract_version: 1, project_id: 'PRJ-1', label: partial.run_id,
    status: 'completed', revision: 1, created_at: '2026-05-04T00:00:00Z', updated_at: '2026-05-04T00:00:00Z',
    inputs: [], outputs: [], attempt: { number: 0 }, attempts: [], conversation_key: `ui:PRJ-1:run:${partial.run_id}`,
    last_project_sequence: 1, last_run_sequence: 1, module_data: {}, ...partial,
  } as WorkflowRun
}

// Shape written by the engine's legacy task_plan.json import.
function importedRuns(): WorkflowRun[] {
  const initiation = run({
    run_id: 'init', module_type: 'initiation', outputs: ['a1'],
    module_data: {
      legacy_import: { version: 2 },
      research_result: { schema_version: 1, references: [], notes: [], gaps: [], searches: [], survey: 's',
        directions: [{ id: 'legacy-core-question', title: 'Does X improve Y?', rationale: 'r' }] },
    },
  })
  const experiment = run({
    run_id: 'exp', module_type: 'experiment', outputs: ['a2'], inputs: [{ artifact_id: 'a1' }],
    module_data: {
      legacy_import: { version: 2 },
      experiments: [{ id: 'Exp001', title: 'one', status: 'completed' }],
      parent_run_id: 'init',
      upstream_selection: { module_type: 'initiation', run_id: 'init', item_id: 'legacy-core-question' },
    },
  })
  const delivery = run({
    run_id: 'del', module_type: 'delivery', outputs: ['a3'], inputs: [{ artifact_id: 'a2' }],
    module_data: {
      legacy_import: { version: 2 },
      parent_run_id: 'exp',
      upstream_selection: { module_type: 'experiment', run_id: 'exp' },
    },
  })
  return [initiation, experiment, delivery]
}

describe('imported legacy Runs stay in scope of the synthesized direction', () => {
  it('lists the imported experiment Run for the legacy direction', () => {
    const runs = importedRuns()
    const selections = { initiation: { runId: 'init', itemId: 'legacy-core-question' } }
    expect(scopedModuleRuns(runs, 'experiment', selections, 'init').runs.map((r) => r.run_id)).toEqual(['exp'])
    expect(scopedModuleRuns(runs, 'experiment', undefined, 'exp').runs.map((r) => r.run_id)).toEqual(['exp'])
  })

  it('lists the imported delivery Run for the imported experiment', () => {
    const runs = importedRuns()
    const selections = {
      initiation: { runId: 'init', itemId: 'legacy-core-question' },
      experiment: { runId: 'exp', itemId: 'Exp001' },
    }
    expect(scopedModuleRuns(runs, 'delivery', selections, 'exp').runs.map((r) => r.run_id)).toEqual(['del'])
  })
})
