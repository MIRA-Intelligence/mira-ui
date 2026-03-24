export function KnowledgePanel({ knowledge, coreQuestion }: {
  knowledge: string[]
  coreQuestion?: string
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          Accumulated Knowledge
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          Key discoveries from all experiments in this project
        </p>

        {coreQuestion && (
          <div className="mb-5 p-3 rounded-lg bg-[var(--color-accent)]/8 border border-[var(--color-accent)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-semibold">
              Core Question
            </span>
            <p className="text-sm text-[var(--color-text-primary)] mt-1 leading-relaxed">
              {coreQuestion}
            </p>
          </div>
        )}

        {knowledge.length === 0 ? (
          <div className="text-sm text-[var(--color-text-muted)] text-center py-12">
            No knowledge accumulated yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {knowledge.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="text-[var(--color-accent)] shrink-0 mt-0.5">•</span>
                <span className="text-[var(--color-text-primary)]">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
