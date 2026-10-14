import { create } from 'zustand'
import {
  cancelRemoteInstall,
  getRemoteInstallPlan,
  installRemoteMira,
  onRemoteInstallOutput,
  type RemoteInstallErrorCode,
  type RemoteInstallPlan,
  type RemoteSshStatus,
} from '@/services/remoteSsh'

// Install offer for Remote-SSH (MIRA-Intelligence/mira-ui#81):
//
//   closed --(attach failed: not_installed / too_old, mira found by discovery)--> offer
//   offer --Install--> installing --ok--> reconnecting --connected--> closed
//                                 \--failed/cancelled--> failed --Try again--> installing
//   reconnecting --error--> failed
//   offer / failed --Cancel or Specify path--> closed (not offered again for this failure)
//
// Nothing is installed unless install() is called from offer or failed, which
// only the dialog's Install / Try again buttons do. Holds no secrets: the log
// is pip/uv output.

export type RemoteInstallStep = 'closed' | 'offer' | 'installing' | 'reconnecting' | 'failed'
export type RemoteInstallReason = 'not_installed' | 'too_old'

export interface RemoteInstallError {
  code: RemoteInstallErrorCode | 'reconnect_failed'
  message: string
  version: string | null
}

// Context the offer depends on: only when the server searched for mira itself
// (no manual command), so an install is what it will find next time.
export interface RemoteInstallContext {
  active: boolean
  host: string
  discovery: boolean
}

const LOG_LIMIT = 200_000

interface RemoteInstallState {
  step: RemoteInstallStep
  host: string | null
  reason: RemoteInstallReason | null
  detail: string
  miraPath: string | null
  plan: RemoteInstallPlan | null
  log: string
  version: string | null
  error: RemoteInstallError | null
  // The current failed attach was dismissed; cleared once the status moves on.
  dismissed: boolean
  observe: (status: RemoteSshStatus, context: RemoteInstallContext) => void
  dismiss: () => void
  install: () => Promise<void>
  cancel: () => void
  reset: () => void
}

const INITIAL = {
  step: 'closed' as RemoteInstallStep,
  host: null,
  reason: null,
  detail: '',
  miraPath: null,
  plan: null,
  log: '',
  version: null,
  error: null,
  dismissed: false,
}

export const useRemoteInstallStore = create<RemoteInstallState>((set, get) => ({
  ...INITIAL,

  observe: (status, context) => {
    const state = get()
    const sameHost = context.active && status.host === context.host
    if (state.step === 'installing') return
    if (state.step === 'reconnecting') {
      if (!sameHost) return
      if (status.phase === 'connected') set({ ...INITIAL })
      else if (status.phase === 'error') {
        set({ step: 'failed', error: { code: 'reconnect_failed', message: status.error?.message ?? '', version: state.version }, dismissed: true })
      }
      return
    }
    if (status.phase !== 'error') {
      // A new attempt: a later failure may be offered again.
      if (state.dismissed || state.step !== 'closed') set({ ...INITIAL, plan: state.plan })
      return
    }
    const code = status.error?.code
    const reason: RemoteInstallReason | null = code === 'not_installed' || code === 'too_old' ? code : null
    if (state.step !== 'closed' || state.dismissed || !reason || !sameHost || !context.discovery) return
    set({
      ...INITIAL,
      step: 'offer',
      host: context.host,
      reason,
      detail: status.error?.message ?? '',
      miraPath: status.miraPath,
      plan: state.plan,
    })
    void getRemoteInstallPlan().then((plan) => {
      if (plan && get().step !== 'closed') set({ plan })
    })
  },

  dismiss: () => {
    if (get().step === 'installing') return
    set({ ...INITIAL, plan: get().plan, dismissed: true })
  },

  install: async () => {
    const state = get()
    if (state.step !== 'offer' && state.step !== 'failed') return
    set({ step: 'installing', log: '', error: null, version: null })
    const off = onRemoteInstallOutput((chunk) => {
      set((current) => ({ log: (current.log + chunk).slice(-LOG_LIMIT) }))
    })
    try {
      const outcome = await installRemoteMira()
      if (get().step !== 'installing') return
      if (outcome.ok) set({ step: 'reconnecting', version: outcome.version })
      else set({ step: 'failed', error: { code: outcome.code, message: outcome.message, version: outcome.version } })
    } finally {
      off()
    }
  },

  cancel: () => {
    if (get().step === 'installing') void cancelRemoteInstall()
  },

  reset: () => set({ ...INITIAL }),
}))
