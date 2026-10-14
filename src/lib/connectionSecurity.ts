// Direct remote engine connections (deployment mode `remoteManual`) are being
// phased out in favour of Remote-SSH. Plaintext http/ws to another machine
// sends prompts, files and the gateway token unencrypted, so we warn about it.

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  return /^127(?:\.\d{1,3}){3}$/.test(host)
}

export function isUnencryptedRemoteEndpoint(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') return false
  return !isLoopbackHost(parsed.hostname)
}

// The bundled local engine already owns 18790 on most desktops, so the
// suggested tunnel listens one port higher.
export const SUGGESTED_TUNNEL_PORT = 18791

export function sshTunnelSuggestion(url: string): { command: string; tunnelUrl: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  const remotePort = parsed.port || '18790'
  // ssh takes bare IPv6 addresses, not the bracketed URL form.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  return {
    command: `ssh -N -L ${SUGGESTED_TUNNEL_PORT}:127.0.0.1:${remotePort} <user>@${host}`,
    tunnelUrl: `http://127.0.0.1:${SUGGESTED_TUNNEL_PORT}/api`,
  }
}
