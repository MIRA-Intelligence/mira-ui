import { useEffect, useRef, useState } from 'react'
import { getLocalEngineStatus, hasDesktopEngineManager, restartLocalEngine, startLocalEngine, stopLocalEngine, type LocalEngineStatusResult } from '@/services/desktop'
import { probeEngineCompatibility } from '@/services/engine'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAgentStore } from '@/stores/agentStore'

type Action = 'start' | 'stop' | 'restart' | 'status'

export function EngineLifecycleControls({ busy, onBusyChange }: { busy: boolean; onBusyChange: (busy: boolean) => void }) {
  const language = useSettingsStore((s) => s.language)
  const zh = language === 'zh'
  const desktop = hasDesktopEngineManager()
  const [status, setStatus] = useState<LocalEngineStatusResult['payload']>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const operation = useRef(false)
  const generation = useRef(0)
  const labels: Record<Action, string> = zh
    ? { start: '启动引擎', stop: '停止引擎', restart: '重启引擎', status: '刷新状态' }
    : { start: 'Start local engine', stop: 'Stop local engine', restart: 'Restart local engine', status: 'Refresh status' }

  const readStatus = async () => {
    const result = await getLocalEngineStatus()
    if (!result) throw new Error(zh ? '桌面引擎管理不可用。' : 'Desktop engine manager is unavailable.')
    if (!result.result.ok || !result.payload) {
      throw new Error(result.payload?.error || result.payload?.last_launchctl_error || result.payload?.windows_service_status
        || result.result.stderr || result.result.stdout || (zh ? '状态查询失败。' : 'Status query failed.'))
    }
    return result.payload
  }

  useEffect(() => {
    if (!desktop) return
    const token = ++generation.current
    void readStatus().then((payload) => {
      if (generation.current === token) setStatus(payload)
    }).catch((err: unknown) => {
      if (generation.current === token) {
        setError(true)
        setMessage(String(err instanceof Error ? err.message : err))
      }
    })
    return () => { generation.current += 1 }
  }, [desktop])

  const run = async (action: Action) => {
    if (!desktop || busy || operation.current) return
    operation.current = true
    ++generation.current // invalidate a slower initial status query
    onBusyChange(true)
    setPending(action)
    setConfirm(null)
    setMessage('')
    setError(false)
    try {
      if (action !== 'status') {
        const result = await ({ start: startLocalEngine, stop: stopLocalEngine, restart: restartLocalEngine }[action])()
        if (!result?.ok) {
          throw new Error(result?.stderr || result?.stdout || (zh
            ? '操作不可用或执行失败。请确认桌面应用与内置引擎均已更新。'
            : 'Command unavailable or failed. Update both the desktop app and bundled engine.'))
        }
      }
      const payload = await readStatus()
      setStatus(payload)
      const activeLocal = useSettingsStore.getState().deploymentMode === 'localBundle'
      if (action === 'stop') {
        if (payload.running !== false || payload.endpoint_gateway) {
          throw new Error(zh ? '仍检测到运行中的 gateway，请检查实例配置。' : 'A gateway is still running; check the instance configuration.')
        }
        if (activeLocal) {
          useSettingsStore.getState().setLocalEngineBootstrap({ phase: 'idle', message: zh ? '引擎已停止' : 'Engine stopped', operation: null })
          useSettingsStore.getState().setEngineBootstrap({ status: 'unreachable', message: zh ? '引擎已手动停止' : 'Engine stopped by user', version: null, uptimeSeconds: null })
          useAgentStore.getState().setConnected(false)
        }
      } else if (action !== 'status') {
        if (!payload.running || payload.healthy === false) {
          throw new Error(zh ? '引擎尚未通过健康检查。' : 'Engine has not passed its health check.')
        }
        const probe = await probeEngineCompatibility('http://127.0.0.1:18790/api')
        if (activeLocal) {
          useSettingsStore.getState().setEngineBootstrap({ status: probe.status, message: probe.message, version: probe.version, uptimeSeconds: probe.uptimeSeconds })
          useSettingsStore.getState().setLocalEngineBootstrap({ phase: probe.status === 'unreachable' ? 'error' : 'ready', message: probe.message, operation: null })
        }
        if (probe.status !== 'compatible') throw new Error(probe.message)
      }
      setMessage(zh ? `${labels[action]}完成。` : `${labels[action]} completed.`)
    } catch (err) {
      setError(true)
      setMessage(err instanceof Error ? err.message : String(err))
      // A command can partly succeed (e.g. service stopped but another gateway
      // owns the port). Refresh read-only; never fall back to bootstrap/start.
      try { setStatus(await readStatus()) } catch { setStatus(null) }
    } finally {
      operation.current = false
      setPending(null)
      onBusyChange(false)
    }
  }

  const value = (flag: boolean | undefined) => flag === undefined ? (zh ? '未知' : 'unknown') : flag ? (zh ? '是' : 'yes') : (zh ? '否' : 'no')
  return (
    <div className="mt-3 space-y-3">
      {!desktop && <p className="text-xs text-[var(--color-text-muted)]">{zh ? '仅桌面版可以管理本机引擎；浏览器或远程引擎请在运行主机上操作。' : 'Local service controls require the desktop app. Manage browser/remote engines on their host.'}</p>}
      {desktop && <div className="text-xs text-[var(--color-text-secondary)] space-y-1" aria-label={zh ? '引擎服务状态' : 'Engine service status'}>
        <p>{zh ? '已安装' : 'Installed'}: {value(status?.installed)} · {zh ? '运行中' : 'Running'}: {value(status?.running)} · {zh ? '健康' : 'Healthy'}: {value(status?.healthy)}</p>
        {status?.pid && <p>PID: {status.pid}</p>}
        {status?.config_path && <p className="break-all">{zh ? '配置' : 'Config'}: {status.config_path}</p>}
        {status?.endpoint_gateway && <p className="text-amber-300 break-all">{zh ? '端口仍有 gateway 响应' : 'Gateway responding on endpoint'}: {status.endpoint_gateway.endpoint} · {status.endpoint_gateway.config_path}</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        {(['start', 'stop', 'restart', 'status'] as const).map((action) => <button key={action}
          disabled={!desktop || busy || pending !== null}
          onClick={() => action === 'stop' || action === 'restart' ? setConfirm(action) : void run(action)}
          className="px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed">
          {labels[action]}{pending === action ? '…' : ''}
        </button>)}
      </div>
      {confirm && <div role="alertdialog" aria-label={zh ? '确认引擎操作' : 'Confirm engine action'} className="rounded-md border border-amber-500/40 p-3 text-xs space-y-2">
        <p>{zh ? '这将断开连接并可能中断正在进行的调研或实验，任务不保证自动恢复。确认继续？' : 'This will disconnect the UI and may interrupt research or experiments. Tasks may not resume automatically. Continue?'}</p>
        <button disabled={busy} className="mr-4 text-amber-300" onClick={() => void run(confirm)}>{zh ? '确认' : 'Confirm'}</button>
        <button disabled={busy} onClick={() => setConfirm(null)}>{zh ? '取消' : 'Cancel'}</button>
      </div>}
      {message && <p role={error ? 'alert' : 'status'} className={`text-xs whitespace-pre-wrap break-words ${error ? 'text-red-300' : 'text-[var(--color-text-muted)]'}`}>{message}</p>}
    </div>
  )
}
