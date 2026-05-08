import { useSettingsStore } from '@/stores/settingsStore'
import { t } from '@/i18n'

interface Props {
  onDone: () => void
}

export function FeedbackSuccessPanel({ onDone }: Props) {
  const lang = useSettingsStore((s) => s.language)

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-10 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-[360px]">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm text-[var(--color-text-primary)] leading-relaxed">
            {t('feedbackSuccessReceived', lang)}
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
        <button
          onClick={onDone}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent)]/80 transition-colors"
        >
          {t('feedbackDoneAction', lang)}
        </button>
      </div>
    </>
  )
}
