import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serverOrigin } from '../src/lib/teamServerUrl'
import {
  TEAM_SERVER_PROTOCOL,
  failure,
  sanitizeTeamServerUser,
  type TeamServerFailure,
  type TeamServerInfoResult,
  type TeamServerSession,
  type TeamServerSessionEvent,
  type TeamServerSessionReason,
  type TeamServerSessionResult,
  type TeamServerUser,
} from '../src/lib/teamServerProtocol'

// Mira Server ("Team server", Mode C in MIRA-Intelligence/mira
// docs/server-edition/architecture.md; client contract in mira#152).
//
// The desktop signs in with a password and receives a short-lived bearer
// access token plus a rotating refresh token. Sign-in and refresh run here in
// the main process so the refresh token never reaches the renderer:
// - the refresh token is kept per server origin, encrypted with Electron
//   safeStorage in <userData>/team-server-sessions.json. Without OS-backed
//   encryption it is kept in memory only (sign in again at the next launch);
// - the renderer receives { accessToken, expiresIn, user } and attaches the
//   access token to its /api, /server and /ws requests;
// - passwords are passed straight to the server and never stored or logged.

export const SESSION_FILE = 'team-server-sessions.json'
const REQUEST_TIMEOUT_MS = 20_000
// Refresh this long before the access token expires (at most 20% of its life).
const REFRESH_LEAD_MS = 60_000
const MIN_REFRESH_DELAY_MS = 5_000
const RETRY_REFRESH_MS = 30_000
// An access token this close to expiry is refreshed before it is handed out.
const EXPIRY_SKEW_MS = 30_000
const MAX_TOKEN_LENGTH = 8192

export interface SecretCodec {
  available(): boolean
  encrypt(plain: string): string
  decrypt(encoded: string): string
}

type LogFields = Record<string, string | number | boolean | null>

export interface TeamServerDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  storePath: () => string
  codec: SecretCodec
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  log?: (event: string, fields?: LogFields) => void
  requestTimeoutMs?: number
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  getSelectedStorageBackend?: () => string
}

// Electron safeStorage. On Linux without a keyring it falls back to a
// hard-coded key ("basic_text"), which is no better than plain text, so that
// counts as unavailable.
export function safeStorageCodec(safeStorage: SafeStorageLike, platform = process.platform): SecretCodec {
  return {
    available: () => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false
        return !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')
      } catch {
        return false
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
  }
}

interface StoredEntry {
  refreshToken: string
  savedAt: number
}

interface StoreData {
  version: 1
  sessions: Record<string, StoredEntry>
}

interface LiveSession {
  accessToken: string
  expiresIn: number
  expiresAt: number
  user: TeamServerUser
  timer: unknown
}

interface TokenResponse {
  accessToken: string
  expiresIn: number
  refreshToken: string
  user: TeamServerUser
}

interface HttpResult {
  status: number
  body: unknown
  retryAfter: number | null
}

function isFailure(value: HttpResult | TeamServerFailure): value is TeamServerFailure {
  return 'ok' in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
}

export function parseTokenResponse(body: unknown): TokenResponse | null {
  if (!isRecord(body)) return null
  const user = sanitizeTeamServerUser(body.user)
  const expiresIn = body.expires_in
  if (!isToken(body.access_token) || !isToken(body.refresh_token) || !user) return null
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return { accessToken: body.access_token, expiresIn, refreshToken: body.refresh_token, user }
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.min(3600, Math.max(0, Math.round((date - Date.now()) / 1000)))
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as { cause?: unknown }).cause
  const causeCode = isRecord(cause) && typeof cause.code === 'string' ? cause.code : ''
  const causeMessage = cause instanceof Error ? cause.message : ''
  return [error.message, causeCode, causeMessage].filter(Boolean).join(' ')
}

export function classifyNetworkError(error: unknown): TeamServerFailure {
  if (error instanceof Error && error.name === 'AbortError') return failure('timeout')
  const text = errorText(error)
  // Chromium (net::ERR_CERT_*, ERR_SSL_*) and Node (CERT_HAS_EXPIRED,
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE, ERR_TLS_*) certificate/TLS failures.
  if (/CERT|SSL|TLS|certificate|self[- ]signed/i.test(text)) {
    const code = text.match(/(?:net::)?ERR_[A-Z_]+|[A-Z][A-Z_]{6,}/)?.[0] ?? ''
    return failure('tls', code)
  }
  return failure('network')
}

function serverMessage(body: unknown): string {
  return isRecord(body) && typeof body.message === 'string' ? body.message : ''
}

function serverErrorCode(body: unknown): string {
  return isRecord(body) && typeof body.error === 'string' ? body.error : ''
}

// Maps a failed login/refresh response to an error the UI can explain.
function authFailure(result: HttpResult): TeamServerFailure {
  const message = serverMessage(result.body)
  switch (result.status) {
    case 401: return failure('invalid_credentials', message, 401)
    case 403: return failure('forbidden', message, 403)
    case 429: return failure('too_many_attempts', message, 429, result.retryAfter)
    default: return failure('server_error', message, result.status, result.retryAfter)
  }
}

export class TeamServerManager {
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly live = new Map<string, LiveSession>()
  // Refresh tokens in memory (decrypted). The only copy when safeStorage is unavailable.
  private readonly refreshTokens = new Map<string, string>()
  private readonly refreshing = new Map<string, Promise<TeamServerSessionResult>>()
  // Bumped by login and logout, so a refresh that was already in flight does
  // not resurrect or overwrite the session it raced with.
  private readonly generations = new Map<string, number>()
  private readonly listeners = new Set<(event: TeamServerSessionEvent) => void>()
  private store: StoreData | null = null
  private storeLoad: Promise<StoreData> | null = null
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly deps: TeamServerDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((callback, ms) => {
      const handle = setTimeout(callback, ms)
      ;(handle as { unref?: () => void }).unref?.()
      return handle
    })
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  onSession(listener: (event: TeamServerSessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  persistent(): boolean {
    return this.deps.codec.available()
  }

  // GET /server/info: is this URL a Mira Server we can talk to?
  async info(originInput: string): Promise<TeamServerInfoResult> {
    const origin = serverOrigin(originInput)
    if (!origin) return failure('invalid_url')
    const result = await this.request(origin, '/server/info', { method: 'GET' })
    if (isFailure(result)) return result
    if (result.status !== 200 || !isRecord(result.body)) {
      // Anything that is not a Mira Server answering /server/info.
      return result.status >= 500
        ? failure('server_error', serverMessage(result.body), result.status)
        : failure('not_mira_server', '', result.status)
    }
    const body = result.body
    if (body.product !== 'mira-server') return failure('not_mira_server', '', result.status)
    if (body.protocol !== TEAM_SERVER_PROTOCOL) {
      return failure('protocol_unsupported', String(typeof body.protocol === 'number' ? body.protocol : 'unknown'), result.status)
    }
    const auth = isRecord(body.auth) ? body.auth : {}
    return {
      ok: true,
      version: typeof body.version === 'string' ? body.version : null,
      protocol: body.protocol,
      methods: Array.isArray(auth.methods) ? auth.methods.filter((m: unknown): m is string => typeof m === 'string') : [],
    }
  }

  // POST /server/auth/login. The password is used for this request only.
  async login(originInput: string, username: string, password: string): Promise<TeamServerSessionResult> {
    const origin = serverOrigin(originInput)
    if (!origin) return failure('invalid_url')
    const generation = this.bump(origin)
    const started = this.now()
    const result = await this.request(origin, '/server/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, client: 'desktop' }),
    })
    if (isFailure(result)) {
      this.log('team_server.login_failed', { code: result.code })
      return result
    }
    if (result.status !== 200) {
      const error = authFailure(result)
      this.log('team_server.login_failed', { status: result.status, code: error.code })
      return error
    }
    const tokens = parseTokenResponse(result.body)
    if (!tokens) return failure('invalid_response', '', result.status)
    if (this.generation(origin) !== generation) return failure('signed_out')
    this.log('team_server.login', { duration_ms: this.now() - started })
    return { ok: true, session: await this.adopt(origin, tokens, 'login') }
  }

  // The current access session for an origin, refreshing it (silently, with
  // the stored refresh token) when it is missing or about to expire.
  async session(originInput: string): Promise<TeamServerSessionResult> {
    const origin = serverOrigin(originInput)
    if (!origin) return failure('invalid_url')
    const live = this.live.get(origin)
    if (live && live.expiresAt - EXPIRY_SKEW_MS > this.now()) return { ok: true, session: this.view(live) }
    return this.refresh(origin)
  }

  // Refreshes once for everyone. `rejected` is the access token a request was
  // just refused with: if a newer one was issued meanwhile, that is returned
  // instead of refreshing again.
  async refresh(originInput: string, rejected?: string | null): Promise<TeamServerSessionResult> {
    const origin = serverOrigin(originInput)
    if (!origin) return failure('invalid_url')
    const live = this.live.get(origin)
    if (rejected && live && live.accessToken !== rejected && live.expiresAt - EXPIRY_SKEW_MS > this.now()) {
      return { ok: true, session: this.view(live) }
    }
    const inflight = this.refreshing.get(origin)
    if (inflight) return inflight
    const pending = this.doRefresh(origin).finally(() => {
      if (this.refreshing.get(origin) === pending) this.refreshing.delete(origin)
    })
    this.refreshing.set(origin, pending)
    return pending
  }

  // POST /server/auth/logout, then forget the session locally whatever the
  // server says (it may be unreachable).
  async logout(originInput: string): Promise<boolean> {
    const origin = serverOrigin(originInput)
    if (!origin) return false
    let accessToken = this.live.get(origin)?.accessToken ?? null
    const live = this.live.get(origin)
    if (!live || live.expiresAt <= this.now()) {
      // Revoke server-side too: an expired access token cannot call logout,
      // so trade the refresh token for a fresh one first.
      const refreshed = await this.refresh(origin).catch(() => null)
      accessToken = refreshed?.ok ? refreshed.session.accessToken : null
    }
    this.bump(origin)
    await this.forget(origin, 'logout')
    if (accessToken) {
      const result = await this.request(origin, '/server/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      this.log('team_server.logout', isFailure(result) ? { code: result.code } : { status: result.status })
    }
    return true
  }

  // Timers may have been delayed by sleep; refresh sessions that are due.
  handleResume(): void {
    for (const [origin, live] of this.live) {
      if (live.expiresAt - REFRESH_LEAD_MS <= this.now()) void this.refresh(origin)
    }
  }

  dispose(): void {
    for (const live of this.live.values()) if (live.timer) this.clearTimer(live.timer)
    this.live.clear()
  }

  // ---------------------------------------------------------------------

  private async doRefresh(origin: string): Promise<TeamServerSessionResult> {
    const generation = this.generation(origin)
    const refreshToken = await this.loadRefreshToken(origin)
    if (!refreshToken) return failure('signed_out')
    const result = await this.request(origin, '/server/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (this.generation(origin) !== generation) {
      // Signed out or signed in again while this was in flight.
      const live = this.live.get(origin)
      return live ? { ok: true, session: this.view(live) } : failure('signed_out')
    }
    if (isFailure(result)) {
      // Offline: keep the refresh token and try again later.
      this.log('team_server.refresh_failed', { code: result.code })
      return result
    }
    if (result.status === 401 || result.status === 403 || result.status === 400) {
      // Revoked, expired or reused refresh token, or the user lost access.
      this.log('team_server.refresh_rejected', { status: result.status })
      this.bump(origin)
      await this.forget(origin, 'expired')
      return result.status === 403
        ? failure('forbidden', serverMessage(result.body), 403)
        : failure('signed_out', serverMessage(result.body), result.status)
    }
    if (result.status !== 200) {
      this.log('team_server.refresh_failed', { status: result.status })
      return failure('server_error', serverMessage(result.body), result.status, result.retryAfter)
    }
    const tokens = parseTokenResponse(result.body)
    if (!tokens) return failure('invalid_response', '', result.status)
    // Rotation: the old refresh token is now revoked; store the new one.
    return { ok: true, session: await this.adopt(origin, tokens, 'refresh') }
  }

  private async adopt(origin: string, tokens: TokenResponse, reason: TeamServerSessionReason): Promise<TeamServerSession> {
    this.refreshTokens.set(origin, tokens.refreshToken)
    await this.persist(origin, tokens.refreshToken)
    const previous = this.live.get(origin)
    if (previous?.timer) this.clearTimer(previous.timer)
    const live: LiveSession = {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      expiresAt: this.now() + tokens.expiresIn * 1000,
      user: tokens.user,
      timer: null,
    }
    this.live.set(origin, live)
    this.schedule(origin, live)
    const session = this.view(live)
    this.emit({ origin, session, reason })
    return session
  }

  private schedule(origin: string, live: LiveSession, delay?: number): void {
    const lifetime = live.expiresIn * 1000
    const due = delay ?? Math.max(MIN_REFRESH_DELAY_MS, lifetime - Math.min(REFRESH_LEAD_MS, lifetime * 0.2))
    live.timer = this.setTimer(() => {
      live.timer = null
      if (this.live.get(origin) !== live) return
      void this.refresh(origin).then((result) => {
        // A transient failure keeps the session; try again while it is valid.
        const current = this.live.get(origin)
        if (!result.ok && current === live && result.code !== 'signed_out' && result.code !== 'forbidden') {
          this.schedule(origin, live, RETRY_REFRESH_MS)
        }
      })
    }, due)
  }

  private async forget(origin: string, reason: TeamServerSessionReason): Promise<void> {
    const live = this.live.get(origin)
    if (live?.timer) this.clearTimer(live.timer)
    this.live.delete(origin)
    this.refreshTokens.delete(origin)
    await this.persist(origin, null)
    this.emit({ origin, session: null, reason })
  }

  private view(live: LiveSession): TeamServerSession {
    return {
      accessToken: live.accessToken,
      expiresIn: Math.max(1, Math.round((live.expiresAt - this.now()) / 1000)),
      user: live.user,
      persistent: this.persistent(),
    }
  }

  private emit(event: TeamServerSessionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* a listener must not break sign-in */ }
    }
  }

  private generation(origin: string): number {
    return this.generations.get(origin) ?? 0
  }

  private bump(origin: string): number {
    const next = this.generation(origin) + 1
    this.generations.set(origin, next)
    return next
  }

  private log(event: string, fields: LogFields = {}): void {
    try { this.deps.log?.(event, fields) } catch { /* best effort */ }
  }

  private async request(origin: string, pathname: string, init: RequestInit): Promise<HttpResult | TeamServerFailure> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      if (init.body) headers.set('Content-Type', 'application/json')
      const response = await this.deps.fetch(`${origin}${pathname}`, {
        ...init,
        headers,
        // A redirect could carry the password to another origin.
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      let body: unknown = null
      try { body = await response.json() } catch { body = null }
      return { status: response.status, body, retryAfter: parseRetryAfter(response.headers.get('retry-after')) }
    } catch (error) {
      return classifyNetworkError(error)
    } finally {
      clearTimeout(timer)
    }
  }

  // ----- refresh-token storage ------------------------------------------

  private async loadStore(): Promise<StoreData> {
    if (this.store) return this.store
    this.storeLoad ??= (async () => {
      const empty: StoreData = { version: 1, sessions: {} }
      try {
        const parsed = JSON.parse(await fs.readFile(this.deps.storePath(), 'utf8')) as unknown
        if (!isRecord(parsed) || !isRecord(parsed.sessions)) return empty
        const sessions: Record<string, StoredEntry> = {}
        for (const [origin, entry] of Object.entries(parsed.sessions)) {
          if (serverOrigin(origin) !== origin || !isRecord(entry) || typeof entry.refreshToken !== 'string') continue
          sessions[origin] = { refreshToken: entry.refreshToken, savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0 }
        }
        return { version: 1, sessions }
      } catch {
        return empty
      }
    })()
    this.store = await this.storeLoad
    return this.store
  }

  private async loadRefreshToken(origin: string): Promise<string | null> {
    const cached = this.refreshTokens.get(origin)
    if (cached) return cached
    const store = await this.loadStore()
    const entry = store.sessions[origin]
    if (!entry || !this.deps.codec.available()) return null
    try {
      const token = this.deps.codec.decrypt(entry.refreshToken)
      if (!isToken(token)) throw new Error('invalid')
      this.refreshTokens.set(origin, token)
      return token
    } catch {
      // Keychain changed or the file was tampered with: sign in again.
      this.log('team_server.stored_token_unreadable')
      await this.persist(origin, null)
      return null
    }
  }

  private async persist(origin: string, refreshToken: string | null): Promise<void> {
    const store = await this.loadStore()
    if (refreshToken && this.deps.codec.available()) {
      store.sessions[origin] = { refreshToken: this.deps.codec.encrypt(refreshToken), savedAt: this.now() }
    } else {
      // Never written in plain text: without encryption it lives in memory only.
      if (!store.sessions[origin]) return
      delete store.sessions[origin]
    }
    const snapshot = JSON.stringify(store, null, 2)
    this.writes = this.writes.then(() => this.writeStore(snapshot))
    await this.writes
  }

  private async writeStore(contents: string): Promise<void> {
    const file = this.deps.storePath()
    const temporary = `${file}.${process.pid}.tmp`
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporary, file)
    } catch {
      this.log('team_server.store_write_failed')
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }
}

// ----- IPC ------------------------------------------------------------------

interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void
}

interface IpcEventLike {
  sender: unknown
  senderFrame: unknown
}

export const TEAM_SERVER_CHANNELS = {
  info: 'team-server:info',
  login: 'team-server:login',
  session: 'team-server:session',
  refresh: 'team-server:refresh',
  logout: 'team-server:logout',
  changed: 'team-server:session-changed',
} as const

const MAX_ORIGIN_LENGTH = 2048
const MAX_USERNAME_LENGTH = 256
const MAX_PASSWORD_LENGTH = 4096

function requireOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ORIGIN_LENGTH) throw new Error('Invalid team server URL')
  return value
}

// Sign-in and tokens are served only to the main window's top-level frame
// (never to previewed artifacts in subframes or other windows).
export function registerTeamServerIpc(
  ipcMain: IpcMainLike,
  manager: Pick<TeamServerManager, 'info' | 'login' | 'session' | 'refresh' | 'logout'>,
  isTrustedSender: (event: IpcEventLike) => boolean,
): void {
  const guard = (event: IpcEventLike) => {
    if (!isTrustedSender(event)) throw new Error('Invalid team server sender')
  }
  ipcMain.handle(TEAM_SERVER_CHANNELS.info, async (event, origin) => {
    guard(event)
    return manager.info(requireOrigin(origin))
  })
  ipcMain.handle(TEAM_SERVER_CHANNELS.login, async (event, origin, username, password) => {
    guard(event)
    if (typeof username !== 'string' || !username.trim() || username.length > MAX_USERNAME_LENGTH) throw new Error('Invalid user name')
    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) throw new Error('Invalid password')
    return manager.login(requireOrigin(origin), username.trim(), password)
  })
  ipcMain.handle(TEAM_SERVER_CHANNELS.session, async (event, origin) => {
    guard(event)
    return manager.session(requireOrigin(origin))
  })
  ipcMain.handle(TEAM_SERVER_CHANNELS.refresh, async (event, origin, rejected) => {
    guard(event)
    if (rejected !== undefined && rejected !== null && (typeof rejected !== 'string' || rejected.length > MAX_TOKEN_LENGTH)) {
      throw new Error('Invalid access token')
    }
    return manager.refresh(requireOrigin(origin), rejected ?? null)
  })
  ipcMain.handle(TEAM_SERVER_CHANNELS.logout, async (event, origin) => {
    guard(event)
    return manager.logout(requireOrigin(origin))
  })
}
