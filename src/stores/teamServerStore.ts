import { create } from 'zustand'
import type { TeamServerUser } from '@/lib/teamServerProtocol'

// Team server (Mira Server) sign-in state for the renderer. Holds no tokens:
// the access token lives in services/teamServerAuth.ts (memory only) and the
// refresh token never leaves the main process.

export type TeamServerPhase = 'unknown' | 'signedOut' | 'signedIn'
export type TeamServerEngineState = 'stopped' | 'starting' | 'running' | 'error' | 'conflict'
export type TeamServerLoginReason = 'settings' | 'manual' | 'expired'

export interface TeamServerEngine {
  state: TeamServerEngineState
  version: string | null
  message: string | null
}

// The engine behind Mira Server could not serve a request right now.
export interface TeamServerEngineIssue {
  code: 'engine_unavailable' | 'engine_conflict'
  message: string | null
}

export interface TeamServerLoginRequest {
  origin: string
  reason: TeamServerLoginReason
}

interface TeamServerState {
  origin: string | null
  phase: TeamServerPhase
  user: TeamServerUser | null
  persistent: boolean
  engine: TeamServerEngine | null
  // Requests currently waiting for the engine to start (503 engine_starting).
  startingRequests: number
  engineIssue: TeamServerEngineIssue | null
  login: TeamServerLoginRequest | null
  // Bumped on every successful sign-in so the connection is set up again.
  sessionEpoch: number

  setSignedIn: (origin: string, user: TeamServerUser, persistent: boolean, fresh?: boolean) => void
  setSignedOut: (origin: string | null) => void
  setEngine: (engine: TeamServerEngine | null) => void
  beginStarting: () => void
  endStarting: () => void
  setEngineIssue: (issue: TeamServerEngineIssue | null) => void
  openLogin: (request: TeamServerLoginRequest) => void
  closeLogin: () => void
  reset: () => void
}

const initial = {
  origin: null,
  phase: 'unknown' as TeamServerPhase,
  user: null,
  persistent: true,
  engine: null,
  startingRequests: 0,
  engineIssue: null,
  login: null,
  sessionEpoch: 0,
}

export const useTeamServerStore = create<TeamServerState>((set) => ({
  ...initial,
  setSignedIn: (origin, user, persistent, fresh = false) => set((state) => ({
    origin,
    phase: 'signedIn',
    user,
    persistent,
    sessionEpoch: fresh ? state.sessionEpoch + 1 : state.sessionEpoch,
  })),
  setSignedOut: (origin) => set({ origin, phase: 'signedOut', user: null, engine: null, engineIssue: null }),
  setEngine: (engine) => set({ engine }),
  beginStarting: () => set((state) => ({ startingRequests: state.startingRequests + 1 })),
  endStarting: () => set((state) => ({ startingRequests: Math.max(0, state.startingRequests - 1) })),
  setEngineIssue: (issue) => set((state) => (
    state.engineIssue?.code === issue?.code && state.engineIssue?.message === issue?.message ? state : { engineIssue: issue }
  )),
  openLogin: (request) => set({ login: request }),
  closeLogin: () => set({ login: null }),
  reset: () => set({ ...initial }),
}))

// Resolves when the sign-in dialog closes: true after a successful sign-in.
let pendingLogin: Array<(signedIn: boolean) => void> = []

export function requestTeamServerLogin(origin: string, reason: TeamServerLoginReason): Promise<boolean> {
  const current = useTeamServerStore.getState().login
  // Keep the dialog that is already open for this server; answer every caller.
  if (!current || current.origin !== origin) {
    finishTeamServerLogin(false)
    useTeamServerStore.getState().openLogin({ origin, reason })
  }
  return new Promise((resolve) => { pendingLogin.push(resolve) })
}

export function finishTeamServerLogin(signedIn: boolean): void {
  const waiting = pendingLogin
  pendingLogin = []
  useTeamServerStore.getState().closeLogin()
  for (const resolve of waiting) resolve(signedIn)
}
