import { useSettingsStore } from '@/stores/settingsStore'
import type { ContractVersion } from '@/types'

export function ExperimentContractMode({ value, onChange, disabled = false }: {
  value: ContractVersion
  onChange: (value: ContractVersion) => void
  disabled?: boolean
}) {
  const zh = useSettingsStore((state) => state.language) === 'zh'
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
        {zh ? '实验验收模式' : 'Experiment acceptance mode'}
      </legend>
      <div className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-0.5">
        {([1, 2] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={value === mode} onClick={() => onChange(mode)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${value === mode
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
            {mode === 1 ? (zh ? '兼容' : 'Compat') : (zh ? '严格' : 'Strict')}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {value === 1
          ? (zh ? '兼容模式不强制要求完整的 profile 验收字段。' : 'Compat does not require all profile-specific acceptance fields.')
          : (zh ? '严格模式按工程/科研/团队要求检查实验记录和证据；不满足时不能标记为完成。' : 'Strict checks experiment records and evidence for the engineering/research/team profile before accepting completion.')}
        {' '}{zh ? '仅用于本次实验，启动后固定；不改变文件访问权限。' : 'Fixed for this experiment run after launch; does not change file access permissions.'}
      </p>
    </fieldset>
  )
}
