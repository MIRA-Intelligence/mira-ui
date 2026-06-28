import { vi } from 'vitest'

/**
 * Install a complete, Map-backed `localStorage` stub on the global scope.
 *
 * jsdom's storage and other test files' partial stubs (e.g. ones missing
 * `clear`) leak across files in a shared worker, so tests that rely on
 * `localStorage` should install their own deterministic implementation in
 * `beforeEach` and call `vi.unstubAllGlobals()` in `afterEach`.
 */
export function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  })
  return store
}
