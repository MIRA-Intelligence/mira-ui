import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

// Slim top banner shown when the main process reports a newer GitHub
// release. Three actions:
//   - Download → opens the release page in the OS browser (no in-app
//     installer in v1).
//   - Later   → hides the banner for this session only (re-appears on
//     next launch if the update is still pending).
//   - Skip    → persists "don't bother me about this version again" to
//     the userData JSON file via IPC.
export function UpdateBanner() {
  const lang = useSettingsStore((s) => s.language)
  const update = useUiStore((s) => s.availableUpdate)
  const dismissed = useUiStore((s) => s.updateBannerDismissed)
  const dismiss = useUiStore((s) => s.dismissUpdateBanner)
  const setAvailableUpdate = useUiStore((s) => s.setAvailableUpdate)

  if (!update || dismissed) return null

  const handleDownload = () => {
    const api = window.electronAPI
    if (api?.openReleasePage) {
      void api.openReleasePage(update.url)
    } else if (typeof window !== 'undefined') {
      window.open(update.url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleSkip = () => {
    const api = window.electronAPI
    if (api?.skipUpdateVersion) {
      void api.skipUpdateVersion(update.version)
    }
    setAvailableUpdate(null)
  }

  return (
    <div
      role="region"
      aria-label={t('updateBannerAria', lang)}
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-accent)]/10 text-[12px] text-[var(--color-text-primary)]"
    >
      <span className="text-base shrink-0" aria-hidden>✨</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium">{t('updateAvailableTitle', lang)}</span>
          <span className="ml-1 text-[var(--color-text-secondary)]">
            {update.name || update.tagName} ·{' '}
            {update.isPrerelease ? t('updatePrereleaseTag', lang) : t('updateStableTag', lang)}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleDownload}
          className="px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white text-[11px] font-medium hover:opacity-90 transition-opacity"
        >
          {t('updateDownloadAction', lang)}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="px-2 py-1 rounded-md text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title={t('updateLaterHint', lang)}
        >
          {t('updateLaterAction', lang)}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className="px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title={t('updateSkipHint', lang)}
        >
          {t('updateSkipAction', lang)}
        </button>
      </div>
    </div>
  )
}
