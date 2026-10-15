import { useId, useState, type ReactNode } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'

/** Temporary container for the legacy Run inspector; remove with the debug UI. */
export function WorkflowDebugPanel({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const lang = useSettingsStore((state) => state.language)

  return (
    <section className="rounded-xl border border-dashed border-[var(--color-border)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{lang === 'zh' ? 'Debug · 运行状态（临时）' : 'Debug · Run status (temporary)'}</span>
        <span className="ml-auto">{expanded ? (lang === 'zh' ? '收起' : 'Collapse') : (lang === 'zh' ? '展开' : 'Expand')}</span>
      </button>
      <div id={panelId} hidden={!expanded} className="p-4 pt-0">
        {children}
      </div>
    </section>
  )
}
