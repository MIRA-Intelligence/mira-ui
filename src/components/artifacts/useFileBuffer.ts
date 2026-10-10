import { useEffect, useState } from 'react'

export type FileBufferState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; buffer: ArrayBuffer }

export function useFileBuffer(url: string): FileBufferState {
  const [state, setState] = useState<FileBufferState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.arrayBuffer()
      })
      .then((buffer) => {
        if (!cancelled) setState({ status: 'ok', buffer })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return state
}
