export type EngineProbeStatus = 'compatible' | 'incompatible' | 'unreachable'

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

    return { status: 'compatible', message: 'Local engine is compatible.', version }
  } catch {
    return {
      status: 'unreachable',
      message: 'Unable to reach local engine. Start medpilot-agent service and retry.',
      version: null,
    }
  }
}
