import { create } from 'zustand'

import {
  decideCommunityApproval,
  fetchCommunityApprovals,
  fetchCommunityProfile,
  saveCommunityProfile,
  fetchCommunityInbox,
  fetchCommunityStatus,
  markCommunityInboxRead,
  setCommunityNotifications,
  onboardCommunity,
  pollCommunityPairing,
  setCommunityAutonomy,
  startCommunityPairing,
  type AutonomyMode,
  type CommunityApproval,
  type CommunityProfile,
  type CommunityProfilePatch,
  type CommunityStatus,
  type InboxItem,
  type NotificationKind,
  type PublicProfileInput,
} from '@/services/community'
import { useUiStore } from '@/stores/uiStore'

interface PairingState {
  active: boolean
  verificationUrl: string | null
  userCode: string | null
  error: string | null
}

/** The agent's community profile as shown in Settings. */
interface ProfileState {
  data: CommunityProfile | null
  phase: 'idle' | 'loading' | 'saving' | 'saved' | 'error'
  error: string | null
}

const IDLE_PROFILE: ProfileState = { data: null, phase: 'idle', error: null }

interface CommunityState {
  status: CommunityStatus | null
  approvals: CommunityApproval[]
  /** The user's notifications, newest first. */
  inbox: InboxItem[]
  loading: boolean
  error: string | null
  pairing: PairingState
  decidingId: string | null
  onboarding: boolean
  profile: ProfileState

  refresh: () => Promise<void>
  refreshApprovals: () => Promise<void>
  setAutonomy: (mode: AutonomyMode) => Promise<void>
  decide: (id: string, decision: 'approve' | 'reject') => Promise<void>
  startPairing: (profile?: PublicProfileInput) => Promise<void>
  cancelPairing: () => void
  onboard: () => Promise<void>
  markRead: (target: { ids: string[] } | { kind: NotificationKind } | { all: true }) => Promise<void>
  setNotifications: (kinds: NotificationKind[]) => Promise<void>
  loadProfile: () => Promise<void>
  /** Save to the community; true when it was saved. */
  saveProfile: (patch: CommunityProfilePatch) => Promise<boolean>
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
  inbox: [],
  loading: false,
  error: null,
  pairing: IDLE_PAIRING,
  decidingId: null,
  onboarding: false,
  profile: IDLE_PROFILE,

  refresh: async () => {
    set({ loading: true })
    const status = await fetchCommunityStatus()
    if (!status) {
      set({ loading: false, error: 'communityLoadError' })
      return
    }
    const [approvals, inbox] = status.logged_in
      ? await Promise.all([fetchCommunityApprovals('pending'), fetchCommunityInbox()])
      : [[], { items: [], unread: null }]
    set({
      status: inbox.unread ? { ...status, unread: inbox.unread } : status,
      approvals,
      inbox: inbox.items,
      loading: false,
      error: null,
    })
  },

  markRead: async (target) => {
    const hit = (item: InboxItem) =>
      'all' in target || ('kind' in target ? item.kind === target.kind : target.ids.includes(item.id))
    // Show it read right away; the engine's counts follow.
    set((s) => ({ inbox: s.inbox.map((item) => (hit(item) ? { ...item, read: true } : item)) }))
    const res = await markCommunityInboxRead(target)
    if (!res.ok) {
      set({ error: res.error ?? 'error' })
      return
    }
    if (res.unread) {
      set((s) => ({ status: s.status ? { ...s.status, unread: res.unread } : s.status }))
    }
  },

  setNotifications: async (kinds) => {
    const res = await setCommunityNotifications(kinds)
    if (!res.ok) {
      set({ error: res.error ?? 'error' })
      return
    }
    set((s) => ({ status: s.status ? { ...s.status, notifications: res.notifications ?? kinds } : s.status }))
  },

  loadProfile: async () => {
    set((s) => ({ profile: { ...s.profile, phase: 'loading', error: null } }))
    const res = await fetchCommunityProfile()
    set((s) =>
      res.ok
        ? { profile: { data: res.data, phase: 'idle', error: null } }
        : { profile: { ...s.profile, phase: 'error', error: res.error } },
    )
  },

  saveProfile: async (patch) => {
    set((s) => ({ profile: { ...s.profile, phase: 'saving', error: null } }))
    const res = await saveCommunityProfile(patch)
    if (!res.ok) {
      set((s) => ({ profile: { ...s.profile, phase: 'error', error: res.error } }))
      return false
    }
    // The header and join defaults read the name and areas from the status.
    set((s) => ({
      profile: { data: res.data, phase: 'saved', error: null },
      status: s.status
        ? { ...s.status, agent_name: res.data.name, domains: res.data.profile.domains }
        : s.status,
    }))
    return true
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
      // The engine answers with its config fields only; keep what it leaves out
      // (member status, unread counts, website). Replacing the status here made
      // the panel briefly claim the agent had not passed its connection test.
      set((s) => ({ status: s.status ? { ...s.status, ...status } : status }))
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

  startPairing: async (profile) => {
    stopPolling()
    set({ pairing: { ...IDLE_PAIRING, active: true } })
    const start = await startCommunityPairing(profile ? { profile } : {})
    if (start.error || !start.poll_token || !start.verification_url) {
      // Back to the join form, error shown there, so a rejected profile field
      // can be fixed and resubmitted right away.
      set({ pairing: { ...IDLE_PAIRING, error: start.error ?? 'pairing failed' } })
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
        // Joined without a private profile: offer the profile wizard now, while
        // the user is here (it opens above the community panel). Older engines
        // don't report the flag, so nothing changes for them.
        if (get().status?.profile_onboarded === false) {
          useUiStore.getState().openOnboarding()
        }
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
