import type { RuntimeConfigPayload } from './runtimeConfig'

export type EngineProbeStatus = 'compatible' | 'incompatible' | 'unreachable' | 'setup_required'

export interface EngineProbeResult {
  status: EngineProbeStatus
  message: string
  version: string | null
}

const COMPATIBILITY = {
  minAgentForUi: '0.1.4',
  apiContract: 'v1',
}

interface VersionPayload {
  agent_version?: string
  api_contract?: string
}

const BUNDLE_SETUP_MODEL = 'custom/mira-ui-bundle-setup'
const BUNDLE_SETUP_API_BASE = 'http://127.0.0.1:9/v1'

function normalizeGatewayBase(apiUrl: string): string {
  return apiUrl.replace(/\/api\/?$/, '')
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

function isApiKeyRequired(provider: string): boolean {
  return provider !== 'custom' && provider !== 'ollama'
}

function explainRuntimeSetup(payload: Partial<RuntimeConfigPayload>): string | null {
  const provider = typeof payload.runtime?.provider === 'string' ? payload.runtime.provider.trim() : ''
  const model = typeof payload.runtime?.model === 'string' ? payload.runtime.model.trim() : ''
  const providerSettings = provider ? payload.providers?.[provider] : undefined

  if (!provider || !model) {
    return 'Local engine is running, but no provider/model is configured yet. Open Settings > Local Runtime Config and fill them in.'
  }

  if (model === BUNDLE_SETUP_MODEL || (provider === 'custom' && providerSettings?.api_base === BUNDLE_SETUP_API_BASE)) {
    return 'Local engine is running, but model access is still unconfigured. Open Settings > Local Runtime Config and set provider, model, and API endpoint details.'
  }

  if (provider === 'custom' && !providerSettings?.api_base) {
    return 'Local engine is running, but Custom provider API Base is empty. Open Settings > Local Runtime Config and set API Base.'
  }

  if (isApiKeyRequired(provider) && !providerSettings?.api_key_configured) {
    return `Local engine is running, but ${provider} is missing its API key. Open Settings > Local Runtime Config and add the credential.`
  }

  return null
}

export async function probeEngineCompatibility(apiUrl: string): Promise<EngineProbeResult> {
  const base = normalizeGatewayBase(apiUrl)
  try {
    const healthResp = await fetch(`${base}/health`)
    if (!healthResp.ok) {
      return {
        status: 'unreachable',
        message: `Local engine health check failed (${healthResp.status}).`,
        version: null,
      }
    }

    const versionResp = await fetch(`${base}/version`)
    if (!versionResp.ok) {
      return {
        status: 'unreachable',
        message: `Local engine version check failed (${versionResp.status}).`,
        version: null,
      }
    }

    const payload = (await versionResp.json()) as VersionPayload
    const version = payload.agent_version ?? null
    const contract = payload.api_contract ?? ''

    if (!version) {
      return {
        status: 'incompatible',
        message: 'Local engine did not report agent version.',
        version: null,
      }
    }

    if (contract !== COMPATIBILITY.apiContract) {
      return {
        status: 'incompatible',
        message: `API contract mismatch: expected ${COMPATIBILITY.apiContract}, got ${contract || 'unknown'}.`,
        version,
      }
    }

    if (isVersionLower(version, COMPATIBILITY.minAgentForUi)) {
      return {
        status: 'incompatible',
        message: `Local engine ${version} is too old. Upgrade to ${COMPATIBILITY.minAgentForUi} or newer.`,
        version,
      }
    }

    const configResp = await fetch(`${base}/api/config`)
    if (!configResp.ok) {
      return {
        status: 'incompatible',
        message: configResp.status === 404 || configResp.status === 405
          ? 'Local engine is reachable, but its runtime config API is unavailable. Upgrade the bundled mira-engine and retry.'
          : `Local engine config check failed (${configResp.status}).`,
        version,
      }
    }

    const runtimePayload = (await configResp.json()) as Partial<RuntimeConfigPayload>
    const setupMessage = explainRuntimeSetup(runtimePayload)
    if (setupMessage) {
      return {
        status: 'setup_required',
        message: setupMessage,
        version,
      }
    }

    return { status: 'compatible', message: 'Local engine is compatible.', version }
  } catch {
    return {
      status: 'unreachable',
      message: 'Unable to reach local engine. MIRA could not contact the local gateway health endpoint.',
      version: null,
    }
  }
}
