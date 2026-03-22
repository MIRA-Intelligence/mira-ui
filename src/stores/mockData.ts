import type { ProjectTask, LogEntry, Stats } from '@/types'

export const mockTasks: ProjectTask[] = [
  { id: 'FA0008', label: 'FA0008', status: 'in_progress', pipelineStage: 'experiment', title: 'Prefix-Ratio GRPO for High-Staleness Rollout Replay (ECHO-2 Follow-up)', steps: [], startedAt: new Date(Date.now() - 35 * 3600_000).toISOString() },
  { id: 'FA0030', label: 'FA0030', status: 'in_progress', pipelineStage: 'planning', title: 'Multi-Modal Radiology Report Generation', steps: [], startedAt: new Date(Date.now() - 12 * 3600_000).toISOString() },
  {
    id: 'FA0039',
    label: 'FA0039',
    status: 'in_progress',
    pipelineStage: 'experiment',
    title: 'Prefix-Ratio GRPO for High-Staleness Rollout Replay (ECHO-2 Follow-up)',
    startedAt: new Date(Date.now() - 35 * 3600_000).toISOString(),
    steps: [
      { id: 's1', number: 1, title: 'Dependencies Installation and Project Structure Initialization', status: 'completed', phases: [] },
      {
        id: 's2', number: 2, title: 'Vanilla GRPO Sanity Check at S=6 and Core Infrastructure Implementation', status: 'running',
        phases: [
          { id: 'p2a', label: 'Phases 1-5: Data prep, staleness buffer, staleness trainer, stability monitor, AIME24 eval, config', status: 'completed' },
          { id: 'p2b', label: 'Phase 6a: Fix bugs from debug run (reward fn kwargs, IS weights zeroing, monitor metric keys)', status: 'completed' },
          { id: 'p2c', label: 'Phase 6b: Run full 10-step sanity check (job dlc1tsygi1dltd6e)', status: 'running' },
          { id: 'p2d', label: 'Phase 7: Verify results, record in EXPERIMENT_RESULTS, update task_plan.json, commit', status: 'pending' },
        ],
      },
      { id: 's3', number: 3, title: 'Vanilla GRPO at S=11 (Stability Test and Quality Extension)', status: 'pending', phases: [] },
      { id: 's4', number: 4, title: 'Tighter-Clipping GRPO at S=11 (Generic Regularization Control)', status: 'pending', phases: [] },
      { id: 's5', number: 5, title: 'Prefix-Ratio GRPO at S=11 (Proposed Method)', status: 'pending', phases: [] },
      { id: 's6', number: 6, title: 'Optimize: Prefix-Ratio GRPO at S=11 (Proposed Method)', status: 'pending', phases: [] },
      { id: 's7', number: 7, title: 'Effectiveness Evaluation of Prefix-Ratio GRPO', status: 'pending', phases: [] },
      { id: 's8', number: 8, title: 'Ratio Tail Diagnostics and Prefix Drift Mechanism Analysis', status: 'pending', phases: [] },
      { id: 's9', number: 9, title: 'Ablation: Prefix-Ratio Combined with Tighter Clipping', status: 'pending', phases: [] },
    ],
  },
  { id: 'FA0031', label: 'FA0031', status: 'in_progress', pipelineStage: 'ideation', title: 'Anatomical Landmark Detection Pipeline', steps: [], startedAt: new Date(Date.now() - 2 * 3600_000).toISOString() },
  { id: 'FA0004', label: 'FA0004', status: 'in_progress', pipelineStage: 'writing', title: 'Chest X-Ray Classification Benchmark', steps: [], startedAt: new Date(Date.now() - 48 * 3600_000).toISOString() },
  { id: 'FA0011', label: 'FA0011', status: 'completed', pipelineStage: 'writing', title: 'Automated Lung Nodule Segmentation', steps: [], startedAt: new Date(Date.now() - 96 * 3600_000).toISOString() },
  { id: 'FA0025', label: 'FA0025', status: 'completed', pipelineStage: 'writing', title: 'Federated Learning for Medical Imaging', steps: [], startedAt: new Date(Date.now() - 72 * 3600_000).toISOString() },
  { id: 'FA0036', label: 'FA0036', status: 'completed', pipelineStage: 'writing', title: 'Domain Adaptation in Radiology AI', steps: [], startedAt: new Date(Date.now() - 120 * 3600_000).toISOString() },
  { id: 'FA0013', label: 'FA0013', status: 'completed', pipelineStage: 'writing', title: 'Knowledge Distillation for Portable Models', steps: [], startedAt: new Date(Date.now() - 200 * 3600_000).toISOString() },
]

export const mockLogs: LogEntry[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    type: 'response',
    content: 'GPU memory is at ~82% (vs ~91% before). The reduced vLLM memory allocation is working. GPUs are at ~99% compute. Let me wait longer for the first step to complete.',
    metadata: {},
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    type: 'tool_call',
    content: 'Train Service  get',
    collapsed: true,
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    type: 'response',
    content: 'Step 1 completed in 50 minutes with v2. The metrics are similar to v1. I notice `actor/pg_loss:0.0` again at step 1. This needs investigation - it could mean GRPO advantages are all zero for this batch (all responses are equally wrong, reward=-1.0 for all), causing zero loss. With GRPO, if every response in a group gets the same reward, the normalized advantage is 0 and there\'s no gradient.\n\nThis is actually expected behavior for the base model at step 1 - Qwen3-8B may get all math problems wrong, giving reward=-1.0 for every response, which means zero GRPO advantage. The loss should become non-zero in later steps as some responses start getting correct answers.\n\nNow let me wait for the job to continue running. The estimate is ~7.5 hours for 10 steps at 50 min/step. Let me check progress periodically:',
  },
  {
    id: 'log-4',
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    type: 'tool_call',
    content: 'Train Service  get',
    collapsed: true,
  },
]

export const mockStats: Stats = {
  hypotheses: 50,
  papers: 9,
  tokens: 1.67e9,
  cost: 13_000,
  stages: [
    { label: 'Launched', active: true },
    { label: 'Hypothesis ×10', active: true },
    { label: 'Paper ×1', active: true },
    { label: 'Paper ×5', active: false },
    { label: 'Hypothesis ×50', active: false },
  ],
}
