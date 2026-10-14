import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t, type I18nKey } from '@/i18n'
import { remoteSshMessage } from '@/lib/remoteSshMessages'
import { useRemoteInstallStore, type RemoteInstallError } from '@/stores/remoteInstallStore'
import { useRemoteSshStore } from '@/stores/remoteSshStore'
import { useSettingsStore, type Language } from '@/stores/settingsStore'

const ERROR_KEYS: Partial<Record<RemoteInstallError['code'], I18nKey>> = {
  no_python: 'sshInstallErrorNoPython',
  too_old: 'sshInstallErrorTooOld',
  cancelled: 'sshInstallErrorCancelled',
  timeout: 'sshInstallErrorTimeout',
  auth_required: 'sshInstallErrorSsh',
  auth_cancelled: 'sshErrorCancelled',
  host_key: 'sshInstallErrorSsh',
  host_key_changed: 'sshErrorHostKeyChanged',
  ssh_failed: 'sshInstallErrorSsh',
  unavailable: 'sshErrorUnavailable',
}

function errorText(error: RemoteInstallError, lang: Language, host: string, reconnectMessage: string): string {
  if (error.code === 'reconnect_failed') return t('sshInstallErrorReconnect', lang, { detail: reconnectMessage })
  return t(ERROR_KEYS[error.code] ?? 'sshInstallErrorFailed', lang, {
    host,
    detail: error.message || error.code,
    version: error.version ?? '?',
  })
}

// Offers to install Mira on a Remote-SSH server where none was found (or only
// one too old for Remote-SSH), shows the exact script first, and streams its
// output. Shown above Settings (it usually opens from there) and below the
// SSH login prompt (z-[2000]), which may appear during the install on Windows.
export function RemoteInstallDialog() {
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const sshHost = useSettingsStore((s) => s.sshHost)
  const sshMiraCommand = useSettingsStore((s) => s.sshMiraCommand)
  const status = useRemoteSshStore((s) => s.status)
  const install = useRemoteInstallStore()
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    useRemoteInstallStore.getState().observe(status, {
      active: deploymentMode === 'remoteSsh',
      host: sshHost.trim(),
      discovery: !sshMiraCommand.trim(),
    })
  }, [status, deploymentMode, sshHost, sshMiraCommand])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [install.log])

  if (install.step === 'closed') return null
  const host = install.host ?? ''
  const running = install.step === 'installing'

  const specifyPath = () => {
    install.dismiss()
    useRemoteSshStore.getState().requestMiraCommandFocus()
    useSettingsStore.getState().openSettings()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    // A running install is stopped only with the Stop button.
    if (!running) install.dismiss()
  }

  const button = (label: string, onClick: () => void, primary = false, autoFocus = false): ReactNode => (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      className={primary
        ? 'h-7 px-3 rounded-md bg-[var(--color-accent)] text-xs font-medium text-white hover:opacity-90'
        : 'h-7 px-3 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'}
    >
      {label}
    </button>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remote-install-title"
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-[640px] max-h-[90vh] flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 id="remote-install-title" className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
            {t('sshInstallTitle', lang, { host })}
          </h2>
        </div>

        <div className="px-4 py-3 space-y-2 overflow-y-auto text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {install.step === 'offer' && (
            <>
              <p className="text-amber-300">
                {install.reason === 'too_old'
                  ? t('sshInstallReasonTooOld', lang, { host, detail: install.detail || '?' })
                  : t('sshInstallReasonNotFound', lang, { host })}
              </p>
              {install.reason === 'too_old' && install.miraPath && (
                <p className="font-mono break-all">{t('sshInstallFoundAt', lang, { path: install.miraPath })}</p>
              )}
              <p>{t('sshInstallWhere', lang, { venv: install.plan?.venv ?? '${MIRA_HOME:-$HOME/.mira}/venv' })}</p>
              <p>{t('sshInstallHow', lang)}</p>
              {install.plan && (
                <>
                  <p className="font-mono break-all">
                    {t('sshInstallPackage', lang, { spec: install.plan.spec })}
                    {!install.plan.defaultSpec && <span className="ml-1 text-amber-300">{t('sshInstallSpecOverride', lang)}</span>}
                  </p>
                  <p className="font-medium text-[var(--color-text-primary)]">{t('sshInstallScriptLabel', lang, { host })}</p>
                  <pre
                    aria-label={t('sshInstallScriptLabel', lang, { host })}
                    className="whitespace-pre overflow-auto max-h-56 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]"
                  >
                    {install.plan.script}
                  </pre>
                </>
              )}
            </>
          )}

          {install.step === 'installing' && <p role="status">{t('sshInstallRunning', lang, { host })}</p>}
          {install.step === 'reconnecting' && (
            <p role="status">{t('sshInstallReconnecting', lang, { version: install.version ?? '?' })}</p>
          )}
          {install.step === 'failed' && install.error && (
            <p role="alert" className="text-red-300 break-words">
              {errorText(install.error, lang, host, remoteSshMessage(status, lang, host))}
            </p>
          )}

          {install.step !== 'offer' && (
            <>
              <p className="font-medium text-[var(--color-text-primary)]">{t('sshInstallOutput', lang)}</p>
              <pre
                ref={logRef}
                aria-label={t('sshInstallOutput', lang)}
                aria-live="polite"
                className="whitespace-pre-wrap break-all overflow-y-auto h-56 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]"
              >
                {install.log}
              </pre>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex flex-wrap justify-end gap-2">
          {install.step === 'offer' && (
            <>
              {button(t('sshInstallCancel', lang), install.dismiss)}
              {button(t('sshInstallManual', lang), specifyPath)}
              {button(t('sshInstallConfirm', lang), () => void install.install(), true, true)}
            </>
          )}
          {install.step === 'installing' && button(t('sshInstallStop', lang), install.cancel)}
          {install.step === 'reconnecting' && button(t('sshInstallClose', lang), install.dismiss)}
          {install.step === 'failed' && (
            <>
              {button(t('sshInstallClose', lang), install.dismiss)}
              {button(t('sshInstallManual', lang), specifyPath)}
              {install.error?.code !== 'reconnect_failed' && button(t('sshInstallRetry', lang), () => void install.install(), true)}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
