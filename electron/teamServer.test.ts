// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_FILE,
  TeamServerManager,
  classifyNetworkError,
  parseRetryAfter,
  registerTeamServerIpc,
  safeStorageCodec,
  type SecretCodec,
  type TeamServerDeps,
} from './teamServer'
import { createMockMiraServer, type MockMiraServer } from '../src/test/mockMiraServer'
import type { TeamServerSessionEvent } from '../src/lib/teamServerProtocol'

const ORIGIN = 'https://mira.example.com'

// Reversible stand-in for safeStorage that makes the ciphertext obviously
// different from the plain token.
function fakeCodec(available = true): SecretCodec & { setAvailable: (value: boolean) => void } {
  let enabled = available
  return {
    available: () => enabled,
    encrypt: (plain) => Buffer.from(`sealed:${plain}`).toString('base64'),
    decrypt: (encoded) => {
      const text = Buffer.from(encoded, 'base64').toString()
      if (!text.startsWith('sealed:')) throw new Error('bad ciphertext')
      return text.slice('sealed:'.length)
    },
    setAvailable: (value) => { enabled = value },
  }
}

interface Harness {
  manager: TeamServerManager
  server: MockMiraServer
  events: TeamServerSessionEvent[]
  timers: Array<{ callback: () => void; ms: number; cleared: boolean }>
  logs: Array<[string, unknown]>
  clock: { now: number }
  file: string
}

describe('TeamServerManager', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mira-team-server-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function setup(overrides: Partial<TeamServerDeps> = {}, server?: MockMiraServer, clock = { now: 1_000_000 }): Harness {
    const mock = server ?? createMockMiraServer({ now: () => clock.now })
    const events: TeamServerSessionEvent[] = []
    const timers: Harness['timers'] = []
    const logs: Harness['logs'] = []
    const file = path.join(dir, SESSION_FILE)
    const manager = new TeamServerManager({
      fetch: (url, init) => mock.fetch(url, init),
      storePath: () => file,
      codec: fakeCodec(),
      now: () => clock.now,
      setTimer: (callback, ms) => {
        const timer = { callback, ms, cleared: false }
        timers.push(timer)
        return timer
      },
      clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true },
      log: (event, fields) => logs.push([event, fields]),
      ...overrides,
    })
    manager.onSession((event) => events.push(event))
    return { manager, server: mock, events, timers, logs, clock, file }
  }

  describe('info', () => {
    it('accepts a Mira Server speaking protocol 1', async () => {
      const { manager } = setup()
      expect(await manager.info(`${ORIGIN}/`)).toEqual({ ok: true, version: '0.1.0', protocol: 1, methods: ['password'] })
    })

    it('rejects other products, other protocols and bad URLs', async () => {
      const server = createMockMiraServer()
      const { manager } = setup({}, server)
      server.state.product = 'something-else'
      expect(await manager.info(ORIGIN)).toMatchObject({ ok: false, code: 'not_mira_server' })
      server.state.product = 'mira-server'
      server.state.protocol = 2
      expect(await manager.info(ORIGIN)).toMatchObject({ ok: false, code: 'protocol_unsupported', message: '2' })
      expect(await manager.info('http://mira.example.com')).toMatchObject({ ok: false, code: 'invalid_url' })
      expect(server.requests).toHaveLength(2)
    })

    it('reports a non-Mira URL, network and TLS failures distinctly', async () => {
      const { manager } = setup({ fetch: async () => new Response('<html>', { status: 404 }) })
      expect(await manager.info(ORIGIN)).toMatchObject({ ok: false, code: 'not_mira_server', status: 404 })
      const offline = setup({ fetch: async () => { throw new TypeError('fetch failed') } })
      expect(await offline.manager.info(ORIGIN)).toMatchObject({ ok: false, code: 'network' })
      const tls = setup({ fetch: async () => { throw new Error('net::ERR_CERT_AUTHORITY_INVALID') } })
      expect(await tls.manager.info(ORIGIN)).toMatchObject({ ok: false, code: 'tls', message: 'net::ERR_CERT_AUTHORITY_INVALID' })
    })
  })

  describe('login', () => {
    it('returns only the access token and user, and stores the refresh token encrypted', async () => {
      const { manager, server, events, file, logs } = setup()
      const result = await manager.login(ORIGIN, 'alice', 'correct horse')
      expect(result).toEqual({
        ok: true,
        session: {
          accessToken: expect.stringMatching(/^at-alice-/),
          expiresIn: 900,
          user: { name: 'alice', displayName: 'Alice Liddell', roles: ['user'] },
          persistent: true,
        },
      })
      expect(server.requests[0]).toMatchObject({ method: 'POST', path: '/server/auth/login', body: { username: 'alice', password: 'correct horse', client: 'desktop' } })
      expect(JSON.stringify(result)).not.toMatch(/rt-alice/)
      expect(events).toEqual([{ origin: ORIGIN, session: expect.objectContaining({ accessToken: expect.any(String) }), reason: 'login' }])

      const contents = await readFile(file, 'utf8')
      const refreshToken = [...server.refresh.keys()][0]
      expect(contents).not.toContain(refreshToken)
      expect(contents).not.toContain('correct horse')
      expect(JSON.parse(contents).sessions[ORIGIN].refreshToken).toBe(Buffer.from(`sealed:${refreshToken}`).toString('base64'))
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
      // Nothing secret reaches the log.
      expect(JSON.stringify(logs)).not.toMatch(/correct horse|rt-alice|at-alice/)
    })

    it.each([
      ['alice', 'wrong', 'invalid_credentials', 401],
      ['nobody', 'x', 'invalid_credentials', 401],
      ['mallory', 'pw', 'forbidden', 403],
    ])('maps %s/%s to %s', async (user, password, code, status) => {
      const { manager, events, file } = setup()
      expect(await manager.login(ORIGIN, user, password)).toMatchObject({ ok: false, code, status })
      expect(events).toEqual([])
      await expect(readFile(file, 'utf8')).rejects.toThrow()
    })

    it('reports rate limiting with Retry-After', async () => {
      const { manager, server } = setup()
      server.state.rateLimited = true
      expect(await manager.login(ORIGIN, 'alice', 'correct horse')).toMatchObject({ ok: false, code: 'too_many_attempts', retryAfter: 30 })
    })

    it('does not follow redirects with the password', async () => {
      const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }))
      const { manager } = setup({ fetch })
      expect(await manager.login(ORIGIN, 'alice', 'pw')).toMatchObject({ ok: false, code: 'server_error', status: 302 })
      expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/server/auth/login`, expect.objectContaining({ redirect: 'manual', credentials: 'omit' }))
    })
  })

  describe('refresh', () => {
    it('rotates the refresh token and always stores the new one', async () => {
      const { manager, server, file, events } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      const [first] = [...server.refresh.keys()]
      const result = await manager.refresh(ORIGIN)
      expect(result).toMatchObject({ ok: true, session: { accessToken: expect.stringMatching(/^at-alice-/) } })
      const second = [...server.refresh.keys()][1]
      expect(server.requests.at(-1)).toMatchObject({ path: '/server/auth/refresh', body: { refresh_token: first } })
      const stored = JSON.parse(await readFile(file, 'utf8')).sessions[ORIGIN].refreshToken
      expect(stored).toBe(Buffer.from(`sealed:${second}`).toString('base64'))
      expect(events.at(-1)).toMatchObject({ reason: 'refresh' })
      // The next refresh presents the rotated token, not the revoked one.
      await manager.refresh(ORIGIN)
      expect(server.requests.at(-1)).toMatchObject({ body: { refresh_token: second } })
      expect(server.revokedFamilies.size).toBe(0)
    })

    it('runs one refresh for concurrent callers (single-flight)', async () => {
      const { manager, server } = setup()
      const login = await manager.login(ORIGIN, 'alice', 'correct horse')
      const current = login.ok ? login.session.accessToken : ''
      let release!: () => void
      server.state.holdRefresh = new Promise((resolve) => { release = resolve })
      // e.g. several requests that all got 401 with the same access token.
      const calls = [manager.refresh(ORIGIN, current), manager.refresh(ORIGIN, current), manager.refresh(ORIGIN)]
      release()
      const results = await Promise.all(calls)
      expect(server.count('POST', '/server/auth/refresh')).toBe(1)
      const tokens = new Set(results.map((r) => (r.ok ? r.session.accessToken : null)))
      expect(tokens.size).toBe(1)
      expect([...tokens][0]).not.toBe(current)
      // No refresh-token reuse, so the session family is intact.
      expect(server.revokedFamilies.size).toBe(0)
    })

    it('returns a newer token instead of refreshing when the rejected one is already replaced', async () => {
      const { manager, server } = setup()
      const login = await manager.login(ORIGIN, 'alice', 'correct horse')
      const refreshed = await manager.refresh(ORIGIN)
      const before = server.count('POST', '/server/auth/refresh')
      const again = await manager.refresh(ORIGIN, login.ok ? login.session.accessToken : null)
      expect(server.count('POST', '/server/auth/refresh')).toBe(before)
      expect(again.ok && refreshed.ok && again.session.accessToken).toBe(refreshed.ok && refreshed.session.accessToken)
    })

    it('signs out when the server rejects the refresh token', async () => {
      const { manager, server, events, file } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      for (const entry of server.refresh.values()) server.revokedFamilies.add(entry.family)
      expect(await manager.refresh(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
      expect(events.at(-1)).toEqual({ origin: ORIGIN, session: null, reason: 'expired' })
      expect(JSON.parse(await readFile(file, 'utf8')).sessions).toEqual({})
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
    })

    it('signs out when the user lost access (403)', async () => {
      const { manager, server } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      server.users.get('alice')!.allowed = false
      expect(await manager.refresh(ORIGIN)).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
    })

    it('keeps the refresh token when the server is unreachable', async () => {
      const { manager, server, events } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      server.state.networkError = new TypeError('fetch failed')
      expect(await manager.refresh(ORIGIN)).toMatchObject({ ok: false, code: 'network' })
      server.state.networkError = null
      expect(await manager.refresh(ORIGIN)).toMatchObject({ ok: true })
      expect(events.map((event) => event.reason)).toEqual(['login', 'refresh'])
    })

    it('ignores a refresh that raced with sign-out', async () => {
      const { manager, server, file } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      server.expireAccessTokens()
      let release!: () => void
      server.state.holdRefresh = new Promise((resolve) => { release = resolve })
      const refreshing = manager.refresh(ORIGIN)
      const loggingOut = manager.logout(ORIGIN)
      release()
      await Promise.all([refreshing, loggingOut])
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
      expect(JSON.parse(await readFile(file, 'utf8')).sessions).toEqual({})
    })

    it('refreshes proactively before the access token expires', async () => {
      const { manager, server, timers, clock, events } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      expect(timers).toHaveLength(1)
      expect(timers[0].ms).toBe(840_000)
      clock.now += 840_000
      timers[0].callback()
      await vi.waitFor(() => expect(events.at(-1)?.reason).toBe('refresh'))
      expect(server.count('POST', '/server/auth/refresh')).toBe(1)
      expect(timers).toHaveLength(2)
      manager.dispose()
      expect(timers[1].cleared).toBe(true)
    })

    it('retries a failed proactive refresh later', async () => {
      const { manager, server, timers } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      server.state.networkError = new TypeError('fetch failed')
      timers[0].callback()
      await vi.waitFor(() => expect(timers).toHaveLength(2))
      expect(timers[1].ms).toBe(30_000)
    })

    it('refreshes an expired access token before handing it out', async () => {
      const { manager, server, clock } = setup()
      const login = await manager.login(ORIGIN, 'alice', 'correct horse')
      expect(await manager.session(ORIGIN)).toEqual(login)
      clock.now += 900_000
      const later = await manager.session(ORIGIN)
      expect(later.ok && login.ok && later.session.accessToken !== login.session.accessToken).toBe(true)
      expect(server.count('POST', '/server/auth/refresh')).toBe(1)
    })
  })

  describe('next launch', () => {
    it('signs in silently with the stored refresh token', async () => {
      const clock = { now: 1_000_000 }
      const server = createMockMiraServer({ now: () => clock.now })
      const first = setup({}, server, clock)
      await first.manager.login(ORIGIN, 'alice', 'correct horse')
      const second = setup({}, server, clock)
      expect(await second.manager.session(ORIGIN)).toMatchObject({ ok: true, session: { user: { name: 'alice' } } })
      expect(server.count('POST', '/server/auth/login')).toBe(1)
      expect(server.count('POST', '/server/auth/refresh')).toBe(1)
    })

    it('is signed out when nothing is stored', async () => {
      const { manager, server } = setup()
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
      expect(server.requests).toHaveLength(0)
    })

    it('drops a stored token that can no longer be decrypted', async () => {
      const file = path.join(dir, SESSION_FILE)
      await writeFile(file, JSON.stringify({ version: 1, sessions: { [ORIGIN]: { refreshToken: Buffer.from('garbage').toString('base64'), savedAt: 1 } } }))
      const { manager, server } = setup()
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
      expect(server.requests).toHaveLength(0)
      expect(JSON.parse(await readFile(file, 'utf8')).sessions).toEqual({})
    })
  })

  describe('without safeStorage', () => {
    it('keeps the refresh token in memory only', async () => {
      const clock = { now: 1_000_000 }
      const server = createMockMiraServer({ now: () => clock.now })
      const { manager, file } = setup({ codec: fakeCodec(false) }, server, clock)
      const login = await manager.login(ORIGIN, 'alice', 'correct horse')
      expect(login).toMatchObject({ ok: true, session: { persistent: false } })
      await expect(readFile(file, 'utf8')).rejects.toThrow()
      // Works for this run...
      expect(await manager.refresh(ORIGIN)).toMatchObject({ ok: true })
      // ...but the next launch has to sign in again.
      const next = setup({ codec: fakeCodec(false) }, server, clock)
      expect(await next.manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
    })

    it('treats the Linux basic_text backend as unavailable', () => {
      const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(value),
        decryptString: (value: Buffer) => value.toString(),
        getSelectedStorageBackend: () => 'basic_text',
      }
      expect(safeStorageCodec(safeStorage, 'linux').available()).toBe(false)
      expect(safeStorageCodec({ ...safeStorage, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux').available()).toBe(true)
      expect(safeStorageCodec(safeStorage, 'darwin').available()).toBe(true)
      expect(safeStorageCodec({ ...safeStorage, isEncryptionAvailable: () => { throw new Error('not ready') } }, 'darwin').available()).toBe(false)
    })
  })

  describe('logout', () => {
    it('revokes the session on the server and forgets it locally', async () => {
      const { manager, server, file, events } = setup()
      const login = await manager.login(ORIGIN, 'alice', 'correct horse')
      expect(await manager.logout(ORIGIN)).toBe(true)
      expect(server.requests.at(-1)).toMatchObject({ method: 'POST', path: '/server/auth/logout', authorization: `Bearer ${login.ok && login.session.accessToken}` })
      expect(server.revokedFamilies.size).toBe(1)
      expect(JSON.parse(await readFile(file, 'utf8')).sessions).toEqual({})
      expect(events.at(-1)).toEqual({ origin: ORIGIN, session: null, reason: 'logout' })
      expect(await manager.session(ORIGIN)).toMatchObject({ ok: false, code: 'signed_out' })
    })

    it('refreshes an expired access token so logout can still revoke the session', async () => {
      const { manager, server, clock } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      clock.now += 901_000
      await manager.logout(ORIGIN)
      expect(server.requests.map((r) => r.path)).toEqual(['/server/auth/login', '/server/auth/refresh', '/server/auth/logout'])
      expect(server.revokedFamilies.size).toBe(1)
    })

    it('signs out locally even when the server is unreachable', async () => {
      const { manager, server, file } = setup()
      await manager.login(ORIGIN, 'alice', 'correct horse')
      server.state.networkError = new TypeError('fetch failed')
      expect(await manager.logout(ORIGIN)).toBe(true)
      expect(JSON.parse(await readFile(file, 'utf8')).sessions).toEqual({})
    })
  })

  it('keeps sessions for different servers apart', async () => {
    const { manager, file } = setup()
    await manager.login(ORIGIN, 'alice', 'correct horse')
    await manager.login('http://127.0.0.1:8443', 'root', 'admin pass')
    const sessions = JSON.parse(await readFile(file, 'utf8')).sessions
    expect(Object.keys(sessions).sort()).toEqual(['http://127.0.0.1:8443', ORIGIN])
    await manager.logout(ORIGIN)
    expect(await manager.session('http://127.0.0.1:8443')).toMatchObject({ ok: true, session: { user: { roles: ['user', 'admin'] } } })
  })
})

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('2')).toBe(2)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThan(5)
  })

  it('classifies network errors', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(classifyNetworkError(abort).code).toBe('timeout')
    expect(classifyNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } })).code).toBe('tls')
    expect(classifyNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })).code).toBe('network')
  })
})

describe('registerTeamServerIpc', () => {
  it('serves only trusted senders and validates arguments', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const manager = {
      info: vi.fn(async () => ({ ok: true })),
      login: vi.fn(async () => ({ ok: true })),
      session: vi.fn(async () => ({ ok: true })),
      refresh: vi.fn(async () => ({ ok: true })),
      logout: vi.fn(async () => true),
    }
    const trusted = { sender: 'main', senderFrame: 'top' }
    registerTeamServerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as never) },
      manager as never,
      (event) => event.sender === 'main' && event.senderFrame === 'top',
    )
    const untrusted = { sender: 'main', senderFrame: 'iframe' }
    for (const channel of handlers.keys()) {
      await expect(Promise.resolve().then(() => handlers.get(channel)!(untrusted, ORIGIN, 'a', 'b'))).rejects.toThrow('Invalid team server sender')
    }
    await handlers.get('team-server:login')!(trusted, ORIGIN, 'alice', 'pw')
    expect(manager.login).toHaveBeenCalledWith(ORIGIN, 'alice', 'pw')
    await expect(Promise.resolve().then(() => handlers.get('team-server:login')!(trusted, ORIGIN, 'a'.repeat(300), 'pw'))).rejects.toThrow('Invalid user name')
    await expect(Promise.resolve().then(() => handlers.get('team-server:session')!(trusted, 'x'.repeat(5000)))).rejects.toThrow('Invalid team server URL')
    await handlers.get('team-server:refresh')!(trusted, ORIGIN)
    expect(manager.refresh).toHaveBeenCalledWith(ORIGIN, null)
  })
})
