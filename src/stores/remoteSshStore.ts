import { create } from 'zustand'
import { IDLE_REMOTE_SSH_STATUS, type RemoteSshStatus } from '@/services/remoteSsh'

// Mirror of the main process's Remote-SSH state. Holds no secrets.
interface RemoteSshState {
  status: RemoteSshStatus
  setStatus: (status: RemoteSshStatus) => void
}

export const useRemoteSshStore = create<RemoteSshState>((set) => ({
  status: IDLE_REMOTE_SSH_STATUS,
  setStatus: (status) => set({ status }),
}))
