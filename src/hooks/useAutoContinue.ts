import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { wsClient } from '@/services/websocket'

const AUTO_DELAY_MS = 4000

export function useAutoContinue() {
  const mode = useProjectStore((s) => s.mode)
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId)
  const tasks = useProjectStore((s) => s.tasks)
  const logsByProject = useAgentStore((s) => s.logsByProject)
  const isStreaming = useAgentStore((s) => s.isStreaming)

  const [countdown, setCountdown] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastLogCountRef = useRef<number>(0)
  const sentRef = useRef(false)

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setCountdown(null)
    sentRef.current = false
  }, [])

  const sendContinue = useCallback(() => {
    if (!selectedTaskId || sentRef.current) return
    sentRef.current = true

    useAgentStore.getState().addLog(selectedTaskId, {
      id: `auto-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: 'Continue.',
      type: 'response',
      metadata: { _user: true, _auto: true },
    })

    wsClient.send({
      type: 'message',
      content: 'Continue with the next step. Update task_plan.json as you progress.',
      session_id: selectedTaskId,
      user_id: 'ui_user',
    })

    setCountdown(null)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    timerRef.current = null
  }, [selectedTaskId])

  useEffect(() => {
    cancel()
  }, [selectedTaskId, cancel])

  useEffect(() => {
    if (mode !== 'auto') {
      cancel()
      return
    }
  }, [mode, cancel])

  useEffect(() => {
    if (mode !== 'auto' || !selectedTaskId || isStreaming) return

    const logs = logsByProject[selectedTaskId] ?? []
    const currentCount = logs.length

    if (currentCount <= lastLogCountRef.current) {
      lastLogCountRef.current = currentCount
      return
    }
    lastLogCountRef.current = currentCount

    const lastLog = logs[logs.length - 1]
    if (!lastLog || lastLog.type !== 'response') return
    if (lastLog.metadata?._user) return

    const task = tasks.find((t) => t.id === selectedTaskId)
    if (task?.status === 'completed') return

    const content = lastLog.content?.toLowerCase() ?? ''
    if (content.includes('error:') || content.includes('failed')) return

    cancel()
    sentRef.current = false

    const startTime = Date.now()
    setCountdown(AUTO_DELAY_MS)

    intervalRef.current = setInterval(() => {
      const remaining = AUTO_DELAY_MS - (Date.now() - startTime)
      if (remaining <= 0) {
        setCountdown(0)
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
      } else {
        setCountdown(remaining)
      }
    }, 50)

    timerRef.current = setTimeout(() => {
      sendContinue()
    }, AUTO_DELAY_MS)

    return () => {
      // cleanup on dependency change handled by cancel() in the other effects
    }
  }, [mode, selectedTaskId, logsByProject, isStreaming, tasks, cancel, sendContinue])

  useEffect(() => {
    return () => cancel()
  }, [cancel])

  return { countdown, cancel, isAuto: mode === 'auto' }
}
