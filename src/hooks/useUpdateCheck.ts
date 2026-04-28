import { useCallback, useEffect, useRef } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

// Bridges the main-process update-check IPC into the renderer:
//   - Subscribes to "update:available" pushes from main and writes them
//     into uiStore.availableUpdate.
//   - Re-triggers the check whenever the user flips the "include
//     prereleases" preference (since that changes which release is
//     "newest" for them).
//
// Safe to mount in non-Electron (web) builds — every electronAPI method
// is optional, and the hook falls back to a noop if absent.
export function useUpdateCheck(): { check: (forceRefresh?: boolean) => void } {
  const setAvailableUpdate = useUiStore((s) => s.setAvailableUpdate)
  const receivePrereleases = useSettingsStore((s) => s.receivePrereleases)
  const lastCheckedFor = useRef<boolean | null>(null)

  const triggerCheck = useCallback(
    (forceRefresh = false) => {
      const api = window.electronAPI
      if (!api?.checkForUpdates) return
      void api
        .checkForUpdates({ includePrereleases: receivePrereleases, forceRefresh })
        .then((info) => {
          // Main also pushes via update:available; setting here gives us a
          // synchronous answer for "Check now" feedback (incl. the null case
          // so the UI can show "you're up to date").
          setAvailableUpdate(info ?? null)
        })
        .catch(() => {
          // Network failure surfaces as null, never as an unhandled rejection.
          setAvailableUpdate(null)
        })
    },
    [receivePrereleases, setAvailableUpdate],
  )

  // Subscribe once to push events from main.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateAvailable) return
    return api.onUpdateAvailable((info) => {
      setAvailableUpdate(info)
    })
  }, [setAvailableUpdate])

  // Re-check whenever the prerelease preference flips. Also drives the
  // initial post-mount check (since `lastCheckedFor` starts as null).
  useEffect(() => {
    if (lastCheckedFor.current === receivePrereleases) return
    lastCheckedFor.current = receivePrereleases
    triggerCheck()
  }, [receivePrereleases, triggerCheck])

  return { check: triggerCheck }
}
