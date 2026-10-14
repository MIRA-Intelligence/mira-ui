import { TeamServerManager } from '../../electron/teamServer'
import type { MockMiraServer } from './mockMiraServer'

// Wires window.electronAPI's Team server bridge to a real main-process
// TeamServerManager talking to the mock Mira Server, so renderer tests run
// the whole sign-in path. Refresh tokens are kept in memory (no keychain).
export function installTeamServerBridge(server: MockMiraServer) {
  const manager = new TeamServerManager({
    fetch: (url, init) => server.fetch(url, init),
    storePath: () => '/nonexistent/mira-team-server-test/sessions.json',
    codec: { available: () => false, encrypt: () => { throw new Error('unused') }, decrypt: () => { throw new Error('unused') } },
    setTimer: () => null,
    clearTimer: () => {},
  })
  const listeners = new Set<(event: unknown) => void>()
  // IPC delivers copies, not shared objects.
  manager.onSession((event) => listeners.forEach((listener) => listener(JSON.parse(JSON.stringify(event)))))
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const bridge = {
    teamServerInfo: async (origin: string) => copy(await manager.info(origin)),
    teamServerLogin: async (origin: string, username: string, password: string) => copy(await manager.login(origin, username, password)),
    teamServerSession: async (origin: string) => copy(await manager.session(origin)),
    teamServerRefresh: async (origin: string, rejected?: string | null) => copy(await manager.refresh(origin, rejected)),
    teamServerLogout: (origin: string) => manager.logout(origin),
    onTeamServerSession: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  window.electronAPI = { ...(window.electronAPI ?? { platform: 'darwin' }), ...bridge }
  return { manager, bridge }
}
