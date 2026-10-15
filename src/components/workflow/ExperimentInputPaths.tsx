import { useEffect, useState } from 'react'
import { validateDataPath, type DataPathValidationResult } from '@/services/api'
import { useSettingsStore } from '@/stores/settingsStore'

export function ExperimentInputPaths({ paths, onChange, onValidChange, disabled = false }: {
  paths: string[]
  onChange: (paths: string[]) => void
  onValidChange: (valid: boolean) => void
  disabled?: boolean
}) {
  const lang = useSettingsStore((s) => s.language)
  const apiUrl = useSettingsStore((s) => s.apiUrl)
  const runtime = useSettingsStore((s) => s.runtimeConfig)
  const [checks, setChecks] = useState<Record<string, DataPathValidationResult>>({})
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let active = true
    const inputs = [...new Set(paths.map((p) => p.trim()).filter(Boolean))]
    setChecks({})
    setChecking(inputs.length > 0)
    onValidChange(inputs.length === 0)
    if (!inputs.length) return
    const timer = setTimeout(() => {
      void Promise.all(inputs.map(async (path) => {
        try { return [path, await validateDataPath(path, 'experiment_input')] as const }
        catch (error) { return [path, { ok: false, error: String(error) }] as const }
      })).then((results) => {
        if (!active) return
        setChecks(Object.fromEntries(results))
        setChecking(false)
        onValidChange(results.every(([, result]) => result.ok))
      })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [paths, apiUrl, runtime?.runtime.workspace_resolved, runtime?.runtime.restrict_to_workspace, onValidChange])

  const change = (next: string[]) => {
    onValidChange(next.every((p) => !p.trim()))
    onChange(next)
  }
  return <fieldset className="mt-4 space-y-2 rounded-xl border border-[var(--color-border)] p-3" disabled={disabled}>
    <legend className="px-1 text-xs font-medium">{lang === 'zh' ? '额外输入路径（可选）' : 'Additional input paths (optional)'}</legend>
    <p className="text-xs text-[var(--color-text-muted)]">{lang === 'zh'
      ? '填写 gateway 所在机器上的文件或目录绝对路径，如数据、文章或代码。启动后仅授权本次实验及其子智能体读取，不授予外部写入权限。'
      : 'Absolute file or folder paths on the gateway machine: data, papers or code. Starting grants this experiment and its delegates read access, not external write access.'}</p>
    {paths.map((path, index) => {
      const result = checks[path.trim()]
      return <div key={index} className="space-y-1">
        <div className="flex gap-2">
          <input aria-label={lang === 'zh' ? `额外输入路径 ${index + 1}` : `Additional input path ${index + 1}`}
            value={path} onChange={(e) => change(paths.map((p, i) => i === index ? e.target.value : p))}
            placeholder={lang === 'zh' ? '例如 /data/study 或 C:\\data\\study' : '/data/study or C:\\data\\study'}
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm" />
          <button type="button" aria-label={lang === 'zh' ? `移除路径 ${index + 1}` : `Remove path ${index + 1}`}
            onClick={() => change(paths.length === 1 ? [''] : paths.filter((_, i) => i !== index))} className="px-2">−</button>
        </div>
        {result && !result.ok && <p role="alert" className="text-xs text-red-400">{result.error || (lang === 'zh' ? '路径不可读取' : 'Path is not readable')}</p>}
        {result?.ok && result.outside_workspace && result.restrict_to_workspace && <p role="alert" className="text-xs text-amber-500">
          {lang === 'zh'
            ? '警告：该文件或目录不在当前 workspace 下。即使已开启严格限制，本次实验仍获准读取。请先备份重要数据以防万一；当前限制并非系统级沙箱。'
            : 'Warning: this path is outside the current workspace. This experiment may read it despite strict mode. Back up important data first; the current restriction is not an OS sandbox.'}
        </p>}
      </div>
    })}
    <button type="button" disabled={disabled || paths.length >= 32} onClick={() => change([...paths, ''])}
      className="text-xs text-[var(--color-accent)]">{lang === 'zh' ? '+ 添加路径' : '+ Add path'}</button>
    {checking && <p role="status" className="text-xs text-[var(--color-text-muted)]">{lang === 'zh' ? '正在验证路径…' : 'Validating paths…'}</p>}
  </fieldset>
}
