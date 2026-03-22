interface JobMonitorProps {
  jobId: string
  service?: string
}

export function JobMonitor({ jobId, service }: JobMonitorProps) {
  return (
    <div className="mx-4 mt-4 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-muted)]">⊙</span>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Job Monitor</span>
        <span className="text-xs font-mono text-[var(--color-text-muted)] ml-auto">{jobId}</span>
      </div>
      {service && (
        <div className="mt-1.5 text-xs text-[var(--color-text-secondary)]">{service}</div>
      )}
    </div>
  )
}
