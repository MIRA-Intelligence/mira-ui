import { useEffect, useId, useRef, useState } from 'react'
import { t, type I18nKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { requestTeamServerLogin, useTeamServerStore, type TeamServerEngineState } from '@/stores/teamServerStore'
import { signOutTeamServer } from '@/services/teamServer'
import { isAdmin } from '@/lib/teamServerProtocol'
import { serverHost, serverOrigin } from '@/lib/teamServerUrl'

const ENGINE_STATE_KEYS: Record<TeamServerEngineState, I18nKey> = {
  stopped: 'teamServerEngineStateStopped',
  starting: 'teamServerEngineStateStarting',
  running: 'teamServerEngineStateRunning',
  error: 'teamServerEngineStateError',
  conflict: 'teamServerEngineStateConflict',
}

// Status-bar account menu in Team server mode: who is signed in (and whether
// they are an admin), on which server, and Sign out. Signed out, it offers
// Sign in instead of prompting on its own.
export function TeamServerUserMenu() {
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const serverUrl = useSettingsStore((s) => s.serverUrl)
  const phase = useTeamServerStore((s) => s.phase)
  const sessionOrigin = useTeamServerStore((s) => s.origin)
  const user = useTeamServerStore((s) => s.user)
  const engine = useTeamServerStore((s) => s.engine)
  const persistent = useTeamServerStore((s) => s.persistent)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const origin = deploymentMode === 'teamServer' ? serverOrigin(serverUrl) : null
  if (!origin) return null
  const host = serverHost(origin)
  const signedIn = phase === 'signedIn' && sessionOrigin === origin && user

  if (!signedIn) {
    if (phase === 'unknown' && sessionOrigin === null) return null
    return (
      <button
        type="button"
        onClick={() => void requestTeamServerLogin(origin, 'manual')}
        title={t('teamServerSignedOut', lang, { host })}
        className="flex items-center gap-1.5 px-2 h-full text-[var(--color-notice-text)] hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--color-warning)]" aria-hidden />
        <span className="truncate">{t('teamServerSignedOutShort', lang)} — {t('teamServerSignIn', lang)}</span>
      </button>
    )
  }

  const admin = isAdmin(user)
  const label = user.displayName || user.name

  const signOut = async () => {
    setBusy(true)
    try {
      await signOutTeamServer(origin)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div ref={root} className="relative flex shrink-0 items-stretch">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('teamServerAccount', lang)}
        title={`${label} · ${host}`}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 px-2 h-full max-w-[220px] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-70">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
        <span className="truncate">{label}</span>
        {admin && <AdminBadge lang={lang} />}
        <span className="truncate opacity-70">@ {host}</span>
      </button>
      {open && (
        <section
          id={menuId}
          role="dialog"
          aria-label={t('teamServerAccount', lang)}
          className="fixed bottom-8 right-3 z-50 w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-xl text-[var(--color-text-primary)]"
        >
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{label}</span>
              {admin ? <AdminBadge lang={lang} /> : (
                <span className="text-[10px] text-[var(--color-text-muted)]">{t('teamServerRoleUser', lang)}</span>
              )}
            </div>
            {user.displayName && user.displayName !== user.name && (
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono truncate">{user.name}</p>
            )}
          </div>
          <dl className="px-3 py-2 space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-muted)]">{t('teamServerServerLabel', lang)}</dt>
              <dd className="truncate font-mono">{host}</dd>
            </div>
            {engine && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-text-muted)]">{t('teamServerEngineLabel', lang)}</dt>
                <dd className="truncate">{t(ENGINE_STATE_KEYS[engine.state], lang)}{engine.version ? ` · ${engine.version}` : ''}</dd>
              </div>
            )}
          </dl>
          {!persistent && (
            <p className="px-3 pb-2 text-[11px] leading-relaxed text-[var(--color-notice-text)]">{t('teamServerNotPersistent', lang)}</p>
          )}
          <div className="px-3 py-2 border-t border-[var(--color-border)] flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className={cn(
                'h-7 px-3 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                busy && 'opacity-60 cursor-not-allowed',
              )}
            >
              {t('teamServerSignOut', lang)}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function AdminBadge({ lang }: { lang: Parameters<typeof t>[1] }) {
  return (
    <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
      {t('teamServerRoleAdmin', lang)}
    </span>
  )
}
