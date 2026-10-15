import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unit tests must never contact a developer's running gateway. Install the
// baseline directly (not via vi.stubGlobal), so restoreAllMocks/unstubAllGlobals
// restore this guard rather than Node's real fetch. API tests explicitly mock it.
globalThis.fetch = async () => {
  throw new Error('Network disabled in unit tests. Mock fetch or the API service explicitly.')
}

afterEach(() => {
  cleanup()
})
