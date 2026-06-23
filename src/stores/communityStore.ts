import { create } from 'zustand'

import {
  decideCommunityApproval,
  fetchCommunityApprovals,
  fetchCommunityStatus,
  onboardCommunity,
  pollCommunityPairing,
  setCommunityAutonomy,
  startCommunityPairing,
  type AutonomyMode,
  type CommunityApproval,
  type CommunityStatus,
} from '@/services/community'

interface PairingState {
  active: boolean
  verificationUrl: string | null
  userCode: string | null
  error: string | null
}

interface CommunityState {
  status: CommunityStatus | null
  approvals: CommunityApproval[]
  loading: boolean
  error: string | null
  pairing: PairingState
  decidingId: string | null
  onboarding: boolean

  refresh: () => Promise<void>
  refreshApprovals: () => Promise<void>
  setAutonomy: (mode: AutonomyMode) => Promise<void>
  decide: (id: string, decision: 'approve' | 'reject') => Promise<void>
  startPairing: () => Promise<void>
  cancelPairing: () => void
  onboard: () => Promise<void>
}

const IDLE_PAIRING: PairingState = {
  active: false,
  verificationUrl: null,
  userCode: null,
  error: null,
}

let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  status: null,
  approvals: [],
  loading: false,
  error: null,
  pairing: IDLE_PAIRING,
  decidingId: null,
  onboarding: false,

  refresh: async () => {
    set({ loading: true })
    const status = await fetchCommunityStatus()
    if (!status) {
      set({ loading: false, error: 'communityLoadError' })
      return
    }
    const approvals = status.logged_in
      ? await fetchCommunityApprovals('pending')
      : []
    set({ status, approvals, loading: false, error: null })
  },

  refreshApprovals: async () => {
    if (!get().status?.logged_in) return
    const approvals = await fetchCommunityApprovals('pending')
    set({ approvals })
  },

  setAutonomy: async (mode) => {
    // Optimistic: reflect the choice immediately, reconcile with the response.
    const prev = get().status
    if (prev) set({ status: { ...prev, autonomy_mode: mode } })
    try {
      const status = await setCommunityAutonomy(mode)
      set({ status })
    } catch (err) {
      set({
        status: prev,
        error: err instanceof Error ? err.message : 'error',
      })
    }
  },

  decide: async (id, decision) => {
    set({ decidingId: id, error: null })
    const res = await decideCommunityApproval(id, decision)
    if (!res.ok) {
      set({ decidingId: null, error: res.error ?? 'error' })
      return
    }
    set((s) => ({
      decidingId: null,
      approvals: s.approvals.filter((a) => a.id !== id),
      status: s.status
        ? { ...s.status, pending_count: Math.max(0, s.status.pending_count - 1) }
        : s.status,
    }))
  },

  startPairing: async () => {
    stopPolling()
    set({ pairing: { ...IDLE_PAIRING, active: true } })
    const start = await startCommunityPairing()
    if (start.error || !start.poll_token || !start.verification_url) {
      set({ pairing: { ...IDLE_PAIRING, active: true, error: start.error ?? 'pairing failed' } })
      return
    }
    set({
      pairing: {
        active: true,
        verificationUrl: start.verification_url,
        userCode: start.user_code ?? null,
        error: null,
      },
    })
    try {
      window.open(start.verification_url, '_blank', 'noopener')
    } catch {
      // ignore — the link is shown in the UI as a fallback
    }

    const pollToken = start.poll_token
    const intervalMs = Math.max(2000, (start.interval ?? 5) * 1000)
    const deadline = Date.now() + (start.expires_in ?? 300) * 1000

    const tick = async () => {
      if (!get().pairing.active) return
      if (Date.now() > deadline) {
        set({ pairing: { ...IDLE_PAIRING, active: true, error: 'pairing expired' } })
        return
      }
      const res = await pollCommunityPairing(pollToken)
      if (res.status === 'authorized') {
        set({ pairing: IDLE_PAIRING })
        await get().refresh()
        return
      }
      if (res.status === 'expired') {
        set({ pairing: { ...IDLE_PAIRING, active: true, error: 'pairing expired' } })
        return
      }
      if (res.status === 'error') {
        set({ pairing: { ...IDLE_PAIRING, active: true, error: res.error } })
        return
      }
      pollTimer = setTimeout(() => void tick(), intervalMs)
    }
    pollTimer = setTimeout(() => void tick(), intervalMs)
  },

  cancelPairing: () => {
    stopPolling()
    set({ pairing: IDLE_PAIRING })
  },

  onboard: async () => {
    if (get().onboarding) return
    set({ onboarding: true, error: null })
    const res = await onboardCommunity()
    set({ onboarding: false })
    if (!res.ok) {
      set({ error: res.error ?? 'onboardError' })
      return
    }
    await get().refresh()
    // The agent composes and posts the welcome reply asynchronously; refresh
    // again shortly to catch the pending -> active transition.
    if (res.triggered || res.pending) {
      setTimeout(() => void get().refresh(), 6000)
      setTimeout(() => void get().refresh(), 15000)
    }
  },
}))
