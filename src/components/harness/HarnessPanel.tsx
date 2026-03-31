import { useEffect, useMemo, useState } from 'react'
import type { ReplayComparison, ReplayReport } from '@/types'
import { compareProjectRuns, fetchProjectReplay, fetchProjectRuns } from '@/services/api'
import { useHarnessStore } from '@/stores/harnessStore'

interface HarnessPanelProps {
  sessionId: string
}

export function HarnessPanel({ sessionId }: HarnessPanelProps) {
  const focusedRun = useHarnessStore((s) => s.focusedRunBySession[sessionId])
  const clearFocusedRun = useHarnessStore((s) => s.clearFocusedRun)
  const [runs, setRuns] = useState<string[]>([])
  const [selectedRun, setSelectedRun] = useState<string>('')
  const [baselineRun, setBaselineRun] = useState<string>('')
  const [report, setReport] = useState<ReplayReport | null>(null)
  const [comparison, setComparison] = useState<ReplayComparison | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reloadRuns() {
    setLoadingRuns(true)
    setError(null)
    const data = await fetchProjectRuns(sessionId)
    setRuns(data)
    setSelectedRun((prev) => prev && data.includes(prev) ? prev : (data[0] ?? ''))
    setBaselineRun((prev) => prev && data.includes(prev) ? prev : '')
    setLoadingRuns(false)
  }

  useEffect(() => {
    void reloadRuns()
    setReport(null)
    setComparison(null)
  }, [sessionId])

  useEffect(() => {
    if (!selectedRun) {
      setReport(null)
      return
    }
    setLoadingReport(true)
    void (async () => {
      const data = await fetchProjectReplay(sessionId, selectedRun)
      if (!data) {
        setError('Failed to load replay report.')
      }
      setReport(data)
      setLoadingReport(false)
    })()
  }, [sessionId, selectedRun])

  useEffect(() => {
    if (!focusedRun) return
    setSelectedRun(focusedRun)
    clearFocusedRun(sessionId)
  }, [focusedRun, sessionId, clearFocusedRun])

  useEffect(() => {
    if (!selectedRun || !baselineRun || selectedRun === baselineRun) {
      setComparison(null)
      return
    }
    setLoadingCompare(true)
    void (async () => {
      const data = await compareProjectRuns(sessionId, selectedRun, baselineRun)
      if (!data) {
        setError('Failed to compare selected runs.')
      }
      setComparison(data)
      setLoadingCompare(false)
    })()
  }, [sessionId, selectedRun, baselineRun])

  const sortedEventStats = useMemo(() => {
    if (!report) return []
    return Object.entries(report.event_type_counts).sort(([a], [b]) => a.localeCompare(b))
  }, [report])

  return (
    <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2 flex items-center gap-1.5">
        <span>🧪</span> Harness Replay
      </h3>

      <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
        <button
          onClick={() => { void reloadRuns() }}
          className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
        >
          Refresh Runs
        </button>

        <label className="flex items-center gap-1">
          <span className="text-[var(--color-text-muted)]">Run</span>
          <select
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
            className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1"
          >
            <option value="">(select)</option>
            {runs.map((run) => <option key={run} value={run}>{run}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-[var(--color-text-muted)]">Baseline</span>
          <select
            value={baselineRun}
            onChange={(e) => setBaselineRun(e.target.value)}
            className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1"
          >
            <option value="">(none)</option>
            {runs.map((run) => <option key={run} value={run}>{run}</option>)}
          </select>
        </label>
      </div>

      {(loadingRuns || loadingReport || loadingCompare) && (
        <p className="text-xs text-[var(--color-text-muted)] mb-2">Loading replay data...</p>
      )}

      {!loadingRuns && runs.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] mb-2">
          No run traces found for this project yet.
        </p>
      )}

      {error && (
        <p className="text-xs text-[var(--color-error)] mb-2">{error}</p>
      )}

      {report && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 mb-3">
          <p className="text-xs font-mono text-[var(--color-text-muted)] mb-2">run_id: {report.run_id}</p>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div>Events: <span className="font-mono">{report.event_count}</span></div>
            <div>Issues: <span className="font-mono">{report.issues.length}</span></div>
            <div>Tool calls: <span className="font-mono">{report.tool_call_count}</span></div>
            <div>Artifacts: <span className="font-mono">{report.artifact_count}</span></div>
          </div>
          <div className="text-xs space-y-1">
            {sortedEventStats.map(([name, count]) => (
              <div key={name} className="font-mono">{name}: {count}</div>
            ))}
          </div>
        </div>
      )}

      {report && report.issues.length > 0 && (
        <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-3 mb-3">
          <p className="text-xs font-semibold text-[var(--color-error)] mb-1">Replay Issues</p>
          <ul className="space-y-1">
            {report.issues.map((issue, idx) => (
              <li key={`${issue.code}-${idx}`} className="text-xs">
                <span className="font-mono">{issue.code}</span>
                {issue.step_id ? ` (${issue.step_id})` : ''}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {comparison && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <p className="text-xs font-semibold mb-1">A/B Delta</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Event delta: <span className="font-mono">{comparison.event_count_delta}</span></div>
            <div>Issue delta: <span className="font-mono">{comparison.issue_count_delta}</span></div>
            <div>Tool call delta: <span className="font-mono">{comparison.tool_call_delta}</span></div>
            <div>Artifact delta: <span className="font-mono">{comparison.artifact_delta}</span></div>
          </div>
          {(comparison.new_artifacts.length > 0 || comparison.removed_artifacts.length > 0) && (
            <div className="mt-2 space-y-1 text-xs">
              {comparison.new_artifacts.map((p) => <div key={`new-${p}`}>+ {p}</div>)}
              {comparison.removed_artifacts.map((p) => <div key={`old-${p}`}>- {p}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

