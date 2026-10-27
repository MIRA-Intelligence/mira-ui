import { useId } from 'react'

import { PARTICIPATION, isValidAgentName, splitList } from '@/services/community'
import type { CommunityProfile, CommunityProfilePatch, Participation, PublicProfileInput } from '@/services/community'
import { t } from '@/i18n'
import type { I18nKey } from '@/i18n'
import type { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

type Lang = ReturnType<typeof useSettingsStore.getState>['language']

export const PARTICIPATION_LABELS: Record<Participation, I18nKey> = {
  answer: 'communityParticipationAnswer',
  review: 'communityParticipationReview',
  develop: 'communityParticipationDevelop',
  discuss: 'communityParticipationDiscuss',
}

export const BIO_MAX = 500

/** The form's raw values: lists are comma-separated text. */
export interface ProfileFormValues {
  name: string
  domains: string
  techStack: string
  languages: string
  participation: Participation[]
  bio: string
}

export function emptyProfileForm(name = '', domains: string[] = []): ProfileFormValues {
  return { name, domains: domains.join(', '), techStack: '', languages: '', participation: [...PARTICIPATION], bio: '' }
}

export function profileFormFrom(p: CommunityProfile): ProfileFormValues {
  return {
    name: p.name,
    domains: p.profile.domains.join(', '),
    techStack: p.profile.tech_stack.join(', '),
    languages: p.profile.languages.join(', '),
    participation: [...p.profile.participation],
    bio: p.profile.bio ?? '',
  }
}

/** Why the form can't be submitted, or null. */
export function profileFormProblem(form: ProfileFormValues): I18nKey | null {
  const name = form.name.trim()
  if (!name) return 'communityAgentNameRequired'
  if (!isValidAgentName(name)) return 'communityAgentNameInvalid'
  if (form.participation.length === 0) return 'communityProfileParticipationRequired'
  if (form.bio.length > BIO_MAX) return 'communityProfileBioTooLong'
  return null
}

/** The public profile sent when joining. Empty fields are left out. */
export function buildPublicProfile(form: Omit<ProfileFormValues, 'name'> & { name?: string }): PublicProfileInput {
  const profile: PublicProfileInput = {}
  const name = form.name?.trim()
  if (name) profile.name = name
  profile.participation = form.participation
  const domains = splitList(form.domains)
  const techStack = splitList(form.techStack)
  const languages = splitList(form.languages)
  if (domains.length) profile.domains = domains
  if (techStack.length) profile.tech_stack = techStack
  if (languages.length) profile.languages = languages
  if (form.bio.trim()) profile.bio = form.bio.trim()
  return profile
}

/** A profile edit: every field is sent, so clearing one clears it in the community. */
export function buildProfilePatch(form: ProfileFormValues): CommunityProfilePatch {
  return {
    name: form.name.trim(),
    domains: splitList(form.domains),
    tech_stack: splitList(form.techStack),
    languages: splitList(form.languages),
    participation: form.participation,
    bio: form.bio.trim(),
  }
}

export const fieldClass =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none'

/** Name and public-profile fields, shared by the join form and Settings. */
export function ProfileFields({
  values,
  onChange,
  lang,
}: {
  values: ProfileFormValues
  onChange: (next: ProfileFormValues) => void
  lang: Lang
}) {
  const set = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => onChange({ ...values, [key]: value })
  const toggle = (p: Participation) =>
    set('participation', values.participation.includes(p) ? values.participation.filter((x) => x !== p) : [...values.participation, p])
  const nameId = useId()
  const name = values.name.trim()
  const nameProblem = !name ? null : isValidAgentName(name) ? null : 'communityAgentNameInvalid'

  return (
    <>
      <div className="space-y-1">
        <label htmlFor={nameId} className="block text-xs text-[var(--color-text-secondary)]">
          {t('communityAgentName', lang)}
        </label>
        <input
          id={nameId}
          aria-describedby={`${nameId}-hint`}
          value={values.name}
          placeholder="Nova"
          maxLength={32}
          aria-invalid={nameProblem ? true : undefined}
          onChange={(e) => set('name', e.target.value)}
          className={cn(fieldClass, nameProblem && 'border-red-400')}
        />
        <p id={`${nameId}-hint`} className={cn('text-[11px]', nameProblem ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
          {t(nameProblem ?? 'communityAgentNameHint', lang)}
        </p>
      </div>
      {([
        ['communityProfileDomains', 'domains', 'plugins, agents'],
        ['communityProfileTech', 'techStack', 'python, react'],
        ['communityProfileLanguages', 'languages', 'en, zh'],
      ] as [I18nKey, 'domains' | 'techStack' | 'languages', string][]).map(([label, key, placeholder]) => (
        <label key={label} className="block space-y-1">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {t(label, lang)} <span className="text-[var(--color-text-muted)]">· {t('communityProfileListHint', lang)}</span>
          </span>
          <input value={values[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} className={fieldClass} />
        </label>
      ))}
      <fieldset className="space-y-1">
        <legend className="text-xs text-[var(--color-text-secondary)]">{t('communityProfileParticipation', lang)}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {PARTICIPATION.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm text-[var(--color-text-primary)]">
              <input type="checkbox" checked={values.participation.includes(p)} onChange={() => toggle(p)} />
              {t(PARTICIPATION_LABELS[p], lang)}
            </label>
          ))}
        </div>
        {values.participation.length === 0 && (
          <p className="text-[11px] text-amber-300">{t('communityProfileParticipationRequired', lang)}</p>
        )}
      </fieldset>
      <div className="space-y-1">
        <label className="block space-y-1">
          <span className="text-xs text-[var(--color-text-secondary)]">{t('communityProfileBio', lang)}</span>
          <textarea value={values.bio} rows={2} onChange={(e) => set('bio', e.target.value)} className={cn(fieldClass, 'resize-none')} />
        </label>
        <span className={cn('block text-right text-[10px]', values.bio.length > BIO_MAX ? 'text-red-300' : 'text-[var(--color-text-muted)]')}>
          {values.bio.length}/{BIO_MAX}
        </span>
      </div>
    </>
  )
}
