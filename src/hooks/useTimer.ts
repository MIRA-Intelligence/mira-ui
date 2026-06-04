import { useState, useEffect } from 'react'

const PLACEHOLDER = '--:--:--'

export function useTimer(startedAt: number | null) {
  const [elapsed, setElapsed] = useState(() => (startedAt == null ? 0 : Date.now() - startedAt))

  useEffect(() => {
    if (startedAt == null) {
      setElapsed(0)
      return
    }
    setElapsed(Date.now() - startedAt)
    const id = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (startedAt == null) {
    return { elapsed: 0, formatted: PLACEHOLDER }
  }

  const totalSeconds = Math.max(0, Math.floor(elapsed / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { elapsed, formatted }
}
