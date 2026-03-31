import { create } from 'zustand'

interface HarnessState {
  focusedRunBySession: Record<string, string>
  focusRun: (sessionId: string, runId: string) => void
  clearFocusedRun: (sessionId: string) => void
}

export const useHarnessStore = create<HarnessState>((set) => ({
  focusedRunBySession: {},
  focusRun: (sessionId, runId) =>
    set((state) => ({
      focusedRunBySession: {
        ...state.focusedRunBySession,
        [sessionId]: runId,
      },
    })),
  clearFocusedRun: (sessionId) =>
    set((state) => {
      if (!state.focusedRunBySession[sessionId]) return state
      const updated = { ...state.focusedRunBySession }
      delete updated[sessionId]
      return { focusedRunBySession: updated }
    }),
}))

