import compatibility from '../../compatibility.json'
import type { RuntimeConfigPayload } from './runtimeConfig'
import { t } from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'

export type EngineProbeStatus = 'compatible' | 'incompatible' | 'unreachable' | 'setup_required'

export interface EngineProbeResult {
  status: EngineProbeStatus
  message: string
  version: string | null
  // Seconds the engine process has been running, as reported by /version.
  // null when unreachable or when the engine predates the uptime field.
  uptimeSeconds: number | null
}

// Sourced from the repo-root compatibility.json (single source of truth shared
// with CI's validate-compatibility.mjs). Update that file, not these consts.
const COMPATIBILITY = {
  minAgentForUi: compatibility.min_agent_for_ui,
  apiContract: compatibility.api_contract,
}

interface VersionPayload {
  agent_version?: string
  api_contract?: string
  uptime_seconds?: number
}

function parseUptimeSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function currentLanguage() {
  return useSettingsStore.getState().language
}

function normalizeApiBase(apiUrl: string): string {
  return apiUrl.replace(/\/$/, '')
}

function parseSemver(input: string): [number, number, number] | null {
  const match = input.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isVersionLower(lhs: string, rhs: string): boolean {
  const l = parseSemver(lhs)
  const r = parseSemver(rhs)
  if (!l || !r) return false
  for (let i = 0; i < 3; i += 1) {
    if (l[i] < r[i]) return true
    if (l[i] > r[i]) return false
  }
  return false
}

function explainRuntimeSetup(payload: Partial<RuntimeConfigPayload>): string | null {
  const provider = typeof payload.runtime?.provider === 'string' ? payload.runtime.provider.trim() : ''
  const model = typeof payload.runtime?.model === 'string' ? payload.runtime.model.trim() : ''
  const lang = currentLanguage()

  if (payload.runtime?.setup_required) {
    const setupCode = payload.runtime.setup_code
    const setupSubject = typeof payload.runtime.setup_subject === 'string'
      ? payload.runtime.setup_subject.trim()
      : ''
    const subject = setupSubject || provider || 'runtime'

    switch (setupCode) {
      case 'missing_runtime':
        return t('runtimeSetupIncomplete', lang)
      case 'unknown_provider':
        return t('runtimeSetupUnknownProvider', lang, { provider: subject })
      case 'missing_api_base':
        return t('runtimeSetupMissingApiBase', lang, { provider: subject })
      case 'missing_api_key':
        return t('runtimeSetupMissingApiKey', lang, { provider: subject })
      default:
        break
    }

    const setupMessage = typeof payload.runtime.setup_message === 'string'
      ? payload.runtime.setup_message.trim()
      : ''
    return setupMessage || t('runtimeSetupIncomplete', lang)
  }

  if (!provider || !model) {
    return t('runtimeSetupIncomplete', currentLanguage())
  }

  return null
}

export async function probeEngineCompatibility(apiUrl: string): Promise<EngineProbeResult> {
  const apiBase = normalizeApiBase(apiUrl)
  const lang = currentLanguage()
  try {
    const healthResp = await fetch(`${apiBase}/health`)
    if (!healthResp.ok) {
      return {
        status: 'unreachable',
        message: t('engineHealthCheckFailed', lang, { status: healthResp.status }),
        version: null,
        uptimeSeconds: null,
      }
    }

    const versionResp = await fetch(`${apiBase}/version`)
    if (!versionResp.ok) {
      return {
        status: 'unreachable',
        message: t('engineVersionCheckFailed', lang, { status: versionResp.status }),
        version: null,
        uptimeSeconds: null,
      }
    }

    const payload = (await versionResp.json()) as VersionPayload
    const version = payload.agent_version ?? null
    const contract = payload.api_contract ?? ''
    const uptimeSeconds = parseUptimeSeconds(payload.uptime_seconds)

    if (!version) {
      return {
        status: 'incompatible',
        message: t('engineMissingVersion', lang),
        version: null,
        uptimeSeconds,
      }
    }

    if (contract !== COMPATIBILITY.apiContract) {
      return {
        status: 'incompatible',
        message: t('engineApiContractMismatch', lang, {
          expected: COMPATIBILITY.apiContract,
          actual: contract || 'unknown',
        }),
        version,
        uptimeSeconds,
      }
    }

    if (isVersionLower(version, COMPATIBILITY.minAgentForUi)) {
      return {
        status: 'incompatible',
        message: t('engineVersionTooOld', lang, {
          version,
          minimum: COMPATIBILITY.minAgentForUi,
        }),
        version,
        uptimeSeconds,
      }
    }

    const configResp = await fetch(`${apiBase}/config`)
    if (!configResp.ok) {
      return {
        status: 'incompatible',
        message: configResp.status === 404 || configResp.status === 405
          ? t('engineRuntimeConfigUnavailable', lang)
          : t('engineConfigCheckFailed', lang, { status: configResp.status }),
        version,
        uptimeSeconds,
      }
    }

    const runtimePayload = (await configResp.json()) as Partial<RuntimeConfigPayload>
    const setupMessage = explainRuntimeSetup(runtimePayload)
    if (setupMessage) {
      return {
        status: 'setup_required',
        message: setupMessage,
        version,
        uptimeSeconds,
      }
    }

    return { status: 'compatible', message: t('engineCompatible', lang), version, uptimeSeconds }
  } catch {
    return {
      status: 'unreachable',
      message: t('engineUnreachable', lang),
      version: null,
      uptimeSeconds: null,
    }
  }
}
