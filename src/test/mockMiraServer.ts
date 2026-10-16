// In-memory Mira Server implementing the desktop client contract from
// MIRA-Intelligence/mira#152 (v1), for tests. Use `server.fetch` as a fetch
// implementation (main-process TeamServerManager or the renderer's window.fetch).

export interface MockUser {
  password: string
  displayName: string
  roles: string[]
  // Member of mira-users.
  allowed: boolean
}

export interface MockRequest {
  method: string
  path: string
  authorization: string | null
  body: unknown
}

interface AccessEntry { user: string; expiresAt: number; family: string }
interface RefreshEntry { user: string; family: string; used: boolean; expiresAt: number }

export interface MockMiraServerOptions {
  now?: () => number
  accessTtl?: number
  refreshTtl?: number
  product?: string
  protocol?: number
  agentVersion?: string
  apiContract?: string
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function error(status: number, code: string, message = '', headers: Record<string, string> = {}): Response {
  return json(status, { error: code, message }, headers)
}

export function createMockMiraServer(options: MockMiraServerOptions = {}) {
  const now = options.now ?? Date.now
  const accessTtl = options.accessTtl ?? 900
  const refreshTtl = options.refreshTtl ?? 30 * 24 * 3600
  let counter = 0
  const users = new Map<string, MockUser>([
    ['alice', { password: 'correct horse', displayName: 'Alice Liddell', roles: ['user'], allowed: true }],
    ['root', { password: 'admin pass', displayName: 'Rita Root', roles: ['user', 'admin'], allowed: true }],
    // Administration account outside mira-users: signs in, has no engine.
    ['dana', { password: 'admin only', displayName: 'Dana Admin', roles: ['admin'], allowed: true }],
    ['mallory', { password: 'pw', displayName: 'Mallory', roles: ['user'], allowed: false }],
  ])
  const access = new Map<string, AccessEntry>()
  const refresh = new Map<string, RefreshEntry>()
  const revokedFamilies = new Set<string>()
  const requests: MockRequest[] = []
  const state = {
    product: options.product ?? 'mira-server',
    protocol: options.protocol ?? 1,
    rateLimited: false,
    // Number of /api requests answered with 503 engine_starting first.
    startingPolls: 0,
    engineState: 'running' as 'stopped' | 'starting' | 'running' | 'error' | 'conflict',
    engineMessage: null as string | null,
    // When set, every request rejects with this network error.
    networkError: null as Error | null,
    // Delay refresh responses until released (for single-flight tests).
    holdRefresh: null as Promise<void> | null,
  }

  const userView = (name: string) => {
    const user = users.get(name)!
    return { name, display_name: user.displayName, roles: user.roles }
  }

  const issue = (user: string, family = `fam-${++counter}`) => {
    const accessToken = `at-${user}-${++counter}`
    const refreshToken = `rt-${user}-${++counter}`
    access.set(accessToken, { user, expiresAt: now() + accessTtl * 1000, family })
    refresh.set(refreshToken, { user, family, used: false, expiresAt: now() + refreshTtl * 1000 })
    return {
      access_token: accessToken,
      expires_in: accessTtl,
      refresh_token: refreshToken,
      refresh_expires_in: refreshTtl,
      user: userView(user),
    }
  }

  const bearer = (authorization: string | null): AccessEntry | null => {
    const token = authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) return null
    const entry = access.get(token)
    if (!entry || entry.expiresAt <= now() || revokedFamilies.has(entry.family)) return null
    if (!users.get(entry.user)?.allowed) return null
    return entry
  }

  const engineView = () => ({
    state: state.engineState,
    version: state.engineState === 'running' ? options.agentVersion ?? '0.5.0' : null,
    message: state.engineMessage,
  })

  async function handle(method: string, url: URL, authorization: string | null, body: unknown): Promise<Response> {
    const path = url.pathname
    if (method === 'GET' && path === '/server/info') {
      return json(200, { product: state.product, version: '0.1.0', protocol: state.protocol, auth: { methods: ['password'] } })
    }
    if (method === 'POST' && path === '/server/auth/login') {
      if (state.rateLimited) return error(429, 'too_many_attempts', 'Slow down', { 'Retry-After': '30' })
      const input = (body ?? {}) as Record<string, unknown>
      const user = typeof input.username === 'string' ? users.get(input.username) : undefined
      if (!user || input.password !== user.password || input.client !== 'desktop') return error(401, 'unauthorized', 'Invalid credentials')
      if (!user.allowed) return error(403, 'forbidden', 'Not a member of mira-users')
      return json(200, issue(input.username as string))
    }
    if (method === 'POST' && path === '/server/auth/refresh') {
      if (state.holdRefresh) await state.holdRefresh
      const token = (body as Record<string, unknown> | null)?.refresh_token
      const entry = typeof token === 'string' ? refresh.get(token) : undefined
      if (!entry || entry.expiresAt <= now() || revokedFamilies.has(entry.family)) return error(401, 'unauthorized')
      if (entry.used) {
        // Reuse of a rotated refresh token revokes the whole session family.
        revokedFamilies.add(entry.family)
        return error(401, 'unauthorized', 'Refresh token reuse')
      }
      if (!users.get(entry.user)?.allowed) return error(403, 'forbidden')
      entry.used = true
      return json(200, issue(entry.user, entry.family))
    }
    if (method === 'POST' && path === '/server/auth/logout') {
      const entry = bearer(authorization)
      if (!entry) return error(401, 'unauthorized')
      revokedFamilies.add(entry.family)
      return new Response(null, { status: 204 })
    }
    if (path === '/server/me' || path.startsWith('/server/engine/') || path.startsWith('/api/')) {
      const entry = bearer(authorization)
      if (!entry) return error(401, 'unauthorized')
      if (method === 'GET' && path === '/server/me') return json(200, { user: userView(entry.user), engine: engineView() })
      if (method === 'POST' && path === '/server/engine/start') {
        if (state.engineState === 'stopped') state.engineState = 'starting'
        return json(200, engineView())
      }
      if (method === 'POST' && path === '/server/engine/stop') {
        state.engineState = 'stopped'
        return json(200, engineView())
      }
      // /api/* reverse proxy.
      if (state.engineState === 'conflict') return error(409, 'engine_conflict', 'Engine lease held by another process')
      if (state.engineState === 'error') return error(503, 'engine_unavailable', state.engineMessage ?? 'Engine failed to start')
      // Starts the engine on demand; the first `startingPolls` requests see 503.
      if (state.startingPolls > 0) {
        state.startingPolls -= 1
        state.engineState = 'starting'
        return error(503, 'engine_starting', '', { 'Retry-After': '2' })
      }
      state.engineState = 'running'
      if (path === '/api/health') return json(200, { status: 'ok' })
      if (path === '/api/version') {
        return json(200, { agent_version: options.agentVersion ?? '0.5.0', api_contract: options.apiContract ?? 'v1', uptime_seconds: 5 })
      }
      return json(200, { path, method })
    }
    return error(404, 'not_found')
  }

  async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    if (state.networkError) throw state.networkError
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    let body: unknown = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    const authorization = headers.get('Authorization')
    requests.push({ method, path: url.pathname, authorization, body })
    return handle(method, url, authorization, body)
  }

  return {
    fetch,
    state,
    users,
    requests,
    access,
    refresh,
    revokedFamilies,
    issue,
    // Every access token expires now (e.g. after sleep).
    expireAccessTokens: () => { for (const entry of access.values()) entry.expiresAt = 0 },
    count: (method: string, path: string) => requests.filter((r) => r.method === method && r.path === path).length,
  }
}

export type MockMiraServer = ReturnType<typeof createMockMiraServer>
