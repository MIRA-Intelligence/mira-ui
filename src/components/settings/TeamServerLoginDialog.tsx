import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { finishTeamServerLogin, useTeamServerStore } from '@/stores/teamServerStore'
import { loginTeamServer, teamServerFailureMessage } from '@/services/teamServer'
import { serverHost } from '@/lib/teamServerUrl'

// Sign-in to a Mira Server. The password goes to the main process with the
// login request and is cleared from this component right after; it is never
// kept in a store, localStorage or logs.
export function TeamServerLoginDialog() {
  const request = useTeamServerStore((s) => s.login)
  const lang = useSettingsStore((s) => s.language)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!request) return
    setUsername(useSettingsStore.getState().serverUsername)
    setPassword('')
    setError(null)
    setBusy(false)
    const timer = setTimeout(() => {
      if (useSettingsStore.getState().serverUsername) passwordRef.current?.focus()
      else usernameRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [request?.origin, request?.reason])

  if (!request) return null
  const host = serverHost(request.origin)

  const cancel = () => {
    if (busy) return
    setPassword('')
    finishTeamServerLogin(false)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setError(null)
    const secret = password
    setPassword('')
    const result = await loginTeamServer(request.origin, username.trim(), secret)
    setBusy(false)
    if (result.ok) {
      useSettingsStore.getState().setServerUsername(username.trim())
      finishTeamServerLogin(true)
      return
    }
    setError(teamServerFailureMessage(result, lang, request.origin))
    setTimeout(() => passwordRef.current?.focus(), 0)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
  }

  const inputClass = 'w-full h-9 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-60'

  // Sign-in usually starts from Settings (z-[100]) or the status bar, so the
  // dialog is portalled to <body> above every other overlay, below the SSH
  // prompt (z-[2000]) and the remote install dialog (z-[1900]).
  return createPortal(
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-server-login-title"
      onKeyDown={onKeyDown}
    >
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-[420px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 id="team-server-login-title" className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
            {t('teamServerLoginTitle', lang, { host })}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            {t(request.reason === 'expired' ? 'teamServerLoginExpiredHint' : 'teamServerLoginHint', lang)}
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          <label className="block">
            <span className="block text-xs text-[var(--color-text-secondary)] mb-1">{t('teamServerUsername', lang)}</span>
            <input
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              disabled={busy}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-[var(--color-text-secondary)] mb-1">{t('teamServerPassword', lang)}</span>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              spellCheck={false}
              disabled={busy}
              className={inputClass}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs leading-relaxed text-red-300 break-words">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="h-7 px-3 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-60"
          >
            {t('cancel', lang)}
          </button>
          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="h-7 px-3 rounded-md bg-[var(--color-accent)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? t('teamServerSigningIn', lang) : t('teamServerSignIn', lang)}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
