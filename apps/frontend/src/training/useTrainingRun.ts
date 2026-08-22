import { useEffect, useState } from 'react'
import { getRunSocketUrl } from '../api/client'

export interface ProgressEvent {
  event: 'progress'
  node_id: string
  epoch: number
  loss: number
  val_loss: number
}

export type TrainingState =
  | { status: 'connecting'; history: ProgressEvent[] }
  | { status: 'running'; history: ProgressEvent[] }
  | { status: 'complete'; history: ProgressEvent[]; metrics: Record<string, unknown> }
  | { status: 'error'; history: ProgressEvent[]; error: string }

type IncomingEvent =
  | ProgressEvent
  | { event: 'complete'; metrics: Record<string, unknown> }
  | { event: 'node_error'; node_id: string; error: string }

function isTerminal(status: TrainingState['status']): boolean {
  return status === 'complete' || status === 'error'
}

export function useTrainingRun(runId: string | null): TrainingState {
  const [state, setState] = useState<TrainingState>({ status: 'connecting', history: [] })

  useEffect(() => {
    setState({ status: 'connecting', history: [] })
    if (!runId) {
      return
    }

    let active = true
    const socket = new WebSocket(getRunSocketUrl(runId))

    socket.onopen = () => {
      if (!active) return
      setState((prev) => (isTerminal(prev.status) ? prev : { status: 'running', history: prev.history }))
    }

    socket.onmessage = (message) => {
      if (!active) return
      const data = JSON.parse(message.data as string) as IncomingEvent
      setState((prev) => {
        if (isTerminal(prev.status)) return prev
        if (data.event === 'progress') {
          return { status: 'running', history: [...prev.history, data] }
        }
        if (data.event === 'complete') {
          return { status: 'complete', history: prev.history, metrics: data.metrics }
        }
        return { status: 'error', history: prev.history, error: data.error }
      })
    }

    const handleDisconnect = () => {
      if (!active) return
      setState((prev) =>
        isTerminal(prev.status) ? prev : { status: 'error', history: prev.history, error: 'connection lost' },
      )
    }
    socket.onerror = handleDisconnect
    socket.onclose = handleDisconnect

    return () => {
      active = false
      socket.close()
    }
  }, [runId])

  return state
}
