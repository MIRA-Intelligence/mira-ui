import { describe, expect, it } from 'vitest'
import { isLoopbackHost, isUnencryptedRemoteEndpoint, sshTunnelSuggestion } from './connectionSecurity'

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])('treats %s as loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['10.0.0.5', '192.168.1.20', 'server.lab.example', '128.0.0.1', '127.0.0.1.example.com', '::2'])('treats %s as remote', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('isUnencryptedRemoteEndpoint', () => {
  it('flags plaintext http and ws to another machine', () => {
    expect(isUnencryptedRemoteEndpoint('http://10.0.0.5:18790/api')).toBe(true)
    expect(isUnencryptedRemoteEndpoint('ws://server.lab.example:18790/ws')).toBe(true)
  })

  it('allows TLS endpoints and loopback tunnels', () => {
    expect(isUnencryptedRemoteEndpoint('https://mira.lab.example/api')).toBe(false)
    expect(isUnencryptedRemoteEndpoint('wss://mira.lab.example/ws')).toBe(false)
    expect(isUnencryptedRemoteEndpoint('http://127.0.0.1:18790/api')).toBe(false)
    expect(isUnencryptedRemoteEndpoint('ws://localhost:18790/ws')).toBe(false)
    expect(isUnencryptedRemoteEndpoint('http://[::1]:18790/api')).toBe(false)
  })

  it('ignores values that are not URLs yet', () => {
    expect(isUnencryptedRemoteEndpoint('')).toBe(false)
    expect(isUnencryptedRemoteEndpoint('10.0.0.5:18790')).toBe(false)
  })
})

describe('sshTunnelSuggestion', () => {
  it('forwards the engine port to a free local port', () => {
    expect(sshTunnelSuggestion('http://10.0.0.5:18790/api')).toEqual({
      command: 'ssh -N -L 18791:127.0.0.1:18790 <user>@10.0.0.5',
      tunnelUrl: 'http://127.0.0.1:18791/api',
    })
  })

  it('keeps a custom engine port and defaults to the gateway port', () => {
    expect(sshTunnelSuggestion('ws://server.lab.example:9000/ws')?.command)
      .toBe('ssh -N -L 18791:127.0.0.1:9000 <user>@server.lab.example')
    expect(sshTunnelSuggestion('http://server.lab.example/api')?.command)
      .toBe('ssh -N -L 18791:127.0.0.1:18790 <user>@server.lab.example')
  })

  it('returns null for invalid URLs', () => {
    expect(sshTunnelSuggestion('not a url')).toBeNull()
  })
})
