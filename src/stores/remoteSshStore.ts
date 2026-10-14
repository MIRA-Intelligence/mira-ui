import { create } from 'zustand'
import { IDLE_REMOTE_SSH_STATUS, type RemoteSshStatus } from '@/services/remoteSsh'

// Mirror of the main process's Remote-SSH state. Holds no secrets.
interface RemoteSshState {
  status: RemoteSshStatus
  setStatus: (status: RemoteSshStatus) => void
  // Bumped to ask Settings to focus the "Remote mira command" field (from the
  // install dialog's "Specify path manually").
  miraCommandFocus: number
  requestMiraCommandFocus: () => void
}

export const useRemoteSshStore = create<RemoteSshState>((set) => ({
  status: IDLE_REMOTE_SSH_STATUS,
  setStatus: (status) => set({ status }),
  miraCommandFocus: 0,
  requestMiraCommandFocus: () => set((state) => ({ miraCommandFocus: state.miraCommandFocus + 1 })),
}))
