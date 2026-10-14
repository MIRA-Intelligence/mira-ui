import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, parseServerUrl, serverOrigin, teamServerEndpoints } from './teamServerUrl'

describe('parseServerUrl', () => {
  it('accepts https origins and normalizes them', () => {
    expect(parseServerUrl(' https://Mira.Example.com/ ')).toEqual({ ok: true, origin: 'https://mira.example.com', host: 'mira.example.com', secure: true })
    expect(parseServerUrl('https://mira.example.com:8443')).toMatchObject({ ok: true, origin: 'https://mira.example.com:8443' })
    expect(parseServerUrl('https://[2001:db8::1]')).toMatchObject({ ok: true, origin: 'https://[2001:db8::1]' })
  })

  it('allows http only for a server on this computer', () => {
    expect(parseServerUrl('http://127.0.0.1:8080')).toMatchObject({ ok: true, origin: 'http://127.0.0.1:8080', secure: false })
    expect(parseServerUrl('http://localhost:8080')).toMatchObject({ ok: true })
    expect(parseServerUrl('http://[::1]:8080')).toMatchObject({ ok: true })
    expect(parseServerUrl('http://mira.example.com')).toEqual({ ok: false, error: 'insecure' })
    expect(parseServerUrl('http://10.0.0.5')).toEqual({ ok: false, error: 'insecure' })
    expect(parseServerUrl('http://127.0.0.1.evil.example')).toEqual({ ok: false, error: 'insecure' })
  })

  it('rejects everything else', () => {
    expect(parseServerUrl('')).toEqual({ ok: false, error: 'empty' })
    expect(parseServerUrl('mira.example.com')).toEqual({ ok: false, error: 'invalid' })
    expect(parseServerUrl('ftp://mira.example.com')).toEqual({ ok: false, error: 'invalid' })
    expect(parseServerUrl('wss://mira.example.com')).toEqual({ ok: false, error: 'invalid' })
    expect(parseServerUrl('https://user:pw@mira.example.com')).toEqual({ ok: false, error: 'invalid' })
    expect(parseServerUrl('https://mira.example.com/api')).toEqual({ ok: false, error: 'path' })
    expect(parseServerUrl('https://mira.example.com/?x=1')).toEqual({ ok: false, error: 'path' })
    expect(parseServerUrl('https://mira.example.com/#top')).toEqual({ ok: false, error: 'path' })
    expect(serverOrigin('nonsense')).toBeNull()
  })

  it('recognizes loopback hosts', () => {
    expect(isLoopbackHostname('127.1.2.3')).toBe(true)
    expect(isLoopbackHostname('LOCALHOST')).toBe(true)
    expect(isLoopbackHostname('localhost.example.com')).toBe(false)
  })
})

describe('teamServerEndpoints', () => {
  it('routes API and WebSocket traffic through the server origin', () => {
    expect(teamServerEndpoints('https://mira.example.com')).toEqual({ apiUrl: 'https://mira.example.com/api', wsUrl: 'wss://mira.example.com/ws' })
    expect(teamServerEndpoints('http://127.0.0.1:8080')).toEqual({ apiUrl: 'http://127.0.0.1:8080/api', wsUrl: 'ws://127.0.0.1:8080/ws' })
  })
})
