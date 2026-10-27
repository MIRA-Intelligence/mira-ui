import { useEffect, useState } from 'react'

import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProfileState, saveProfile } from '@/services/profile'
import { t } from '@/i18n'

const inputClass =
  'w-full h-10 bg-[var(--color-input-bg,var(--color-bg-primary))] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] transition-colors'

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export function OnboardingModal() {
  const { onboardingOpen, closeOnboarding } = useUiStore()
  const lang = useSettingsStore((s) => s.language)

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [userName, setUserName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [languages, setLanguages] = useState('')
  const [agentName, setAgentName] = useState('')
  const [agentIdentity, setAgentIdentity] = useState('')

  useEffect(() => {
    if (!onboardingOpen) return
    setStep(0)
    setError(null)
    setLoading(true)
    void getProfileState()
      .then((state) => {
        setUserName(state.user.name || '')
        setTimezone(state.user.timezone || browserTimezone())
        setLanguages(state.user.languages || '')
        setAgentName(state.agent.name || '')
        setAgentIdentity(state.agent.identity || '')
      })
      .catch(() => {
        setTimezone(browserTimezone())
      })
      .finally(() => setLoading(false))
  }, [onboardingOpen])

  if (!onboardingOpen) return null

  const canNext = userName.trim().length > 0 && languages.trim().length > 0
  const canFinish = agentName.trim().length > 0

  const handleFinish = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveProfile({
        user: { name: userName.trim(), timezone: timezone.trim(), languages: languages.trim() },
        agent: { name: agentName.trim(), identity: agentIdentity.trim() },
      })
      closeOnboarding()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" />
      <div className="relative w-[560px] max-h-[88vh] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {t('onboardingTitle', lang)}
            </h2>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {t('onboardingStep', lang, { current: step + 1, total: 2 })}
            </span>
          </div>
          <button
            onClick={closeOnboarding}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('onboardingIntro', lang)}
          </p>

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {step === 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('onboardingUserHeading', lang)}
              </h3>
              <Field label={t('onboardingUserName', lang)} required>
                <input
                  className={inputClass}
                  value={userName}
                  disabled={loading}
                  placeholder="MIRA User"
                  onChange={(e) => setUserName(e.target.value)}
                />
              </Field>
              <Field label={t('onboardingLanguages', lang)} required hint={t('onboardingLanguagesHint', lang)}>
                <input
                  className={inputClass}
                  value={languages}
                  disabled={loading}
                  placeholder="English, 中文"
                  onChange={(e) => setLanguages(e.target.value)}
                />
              </Field>
              <Field label={t('onboardingTimezone', lang)} hint={t('onboardingTimezoneHint', lang)}>
                <input
                  className={inputClass}
                  value={timezone}
                  disabled={loading}
                  placeholder="Asia/Shanghai"
                  onChange={(e) => setTimezone(e.target.value)}
                />
              </Field>
            </section>
          ) : (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('onboardingAgentHeading', lang)}
              </h3>
              <Field label={t('onboardingAgentName', lang)} required>
                <input
                  className={inputClass}
                  value={agentName}
                  disabled={loading}
                  placeholder="mira 🐈"
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </Field>
              <Field label={t('onboardingAgentIdentity', lang)} hint={t('onboardingAgentIdentityHint', lang)}>
                <input
                  className={inputClass}
                  value={agentIdentity}
                  disabled={loading}
                  placeholder={t('onboardingAgentIdentityPlaceholder', lang)}
                  onChange={(e) => setAgentIdentity(e.target.value)}
                />
              </Field>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={closeOnboarding}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('onboardingSkip', lang)}
          </button>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <button
                onClick={() => setStep(0)}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {t('onboardingBack', lang)}
              </button>
            )}
            {step === 0 ? (
              <button
                onClick={() => setStep(1)}
                disabled={!canNext || loading}
                className="rounded-lg px-4 py-2 text-sm bg-[var(--color-accent)] text-white disabled:opacity-50 transition-opacity"
              >
                {t('onboardingNext', lang)}
              </button>
            ) : (
              <button
                onClick={() => void handleFinish()}
                disabled={!canFinish || saving}
                className="rounded-lg px-4 py-2 text-sm bg-[var(--color-accent)] text-white disabled:opacity-50 transition-opacity"
              >
                {saving ? t('onboardingSaving', lang) : t('onboardingFinish', lang)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  )
}
