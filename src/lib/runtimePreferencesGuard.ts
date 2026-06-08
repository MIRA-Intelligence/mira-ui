import { t, type I18nKey } from '@/i18n'
import type { Language } from '@/stores/settingsStore'

/** Block profile/contract toggles while the agent session is actively streaming. */
export function isRuntimePreferenceSwitchBlocked(isStreaming: boolean): boolean {
  return isStreaming
}

export function runtimePreferenceSwitchBlockTitle(
  lang: Language,
  isStreaming: boolean,
  kind: 'profile' | 'contract',
): string | undefined {
  if (!isStreaming) return undefined
  const key: I18nKey = kind === 'profile' ? 'profileSwitchWhileStreaming' : 'contractSwitchWhileStreaming'
  return t(key, lang)
}
