import { t } from '@/i18n'
import { hasEngineRole, isAdmin } from '@/lib/teamServerProtocol'
import { serverHost } from '@/lib/teamServerUrl'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTeamServerStore } from '@/stores/teamServerStore'

// Shown while an administrator is signed in to a Team server: Mira Server
// answers their settings and provider pages from the team settings, so every
// change there applies to all users.
export function TeamAdminBanner() {
  const lang = useSettingsStore((s) => s.language)
  const deploymentMode = useSettingsStore((s) => s.deploymentMode)
  const phase = useTeamServerStore((s) => s.phase)
  const origin = useTeamServerStore((s) => s.origin)
  const user = useTeamServerStore((s) => s.user)

  if (deploymentMode !== 'teamServer' || phase !== 'signedIn' || !origin || !isAdmin(user)) return null

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-1.5 border-b border-amber-500/30 bg-amber-500/10 text-[12px] text-[var(--color-text-primary)]"
    >
      <span aria-hidden className="shrink-0 text-amber-400">●</span>
      <p className="min-w-0 truncate">
        <span className="font-medium">{t('teamServerAdminBanner', lang, { host: serverHost(origin) })}</span>
        {!hasEngineRole(user) && (
          <span className="ml-1 text-[var(--color-text-secondary)]">{t('teamServerAdminOnlyHint', lang)}</span>
        )}
      </p>
    </div>
  )
}
