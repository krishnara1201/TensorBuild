import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTrainingRun } from '../src/training/useTrainingRun'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function send(socket: MockWebSocket, data: unknown) {
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(data) })
  })
}

describe('useTrainingRun', () => {
  it('stays connecting with empty history when runId is null', () => {
    const { result } = renderHook(() => useTrainingRun(null))

    expect(result.current).toEqual({ status: 'connecting', history: [] })
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('opens a socket to the run and moves to running on open', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:8000/ws/runs/run-1')

    act(() => {
      MockWebSocket.instances[0]?.onopen?.()
    })

    expect(result.current.status).toBe('running')
  })

  it('accumulates progress events into history', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 })
    send(socket, { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.7, val_loss: 0.8 })

    expect(result.current.status).toBe('running')
    expect(result.current.history).toEqual([
      { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 },
      { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.7, val_loss: 0.8 },
    ])
  })

  it('moves to complete with final metrics on a complete event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 })
    send(socket, { event: 'complete', metrics: { 'n6.metrics': { accuracy: 0.95 } } })

    expect(result.current).toEqual({
      status: 'complete',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 }],
      metrics: { 'n6.metrics': { accuracy: 0.95 } },
    })
  })

  it('moves to error with the message on a node_error event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'node_error', node_id: 'n5', error: 'CUDA out of memory' })

    expect(result.current).toEqual({ status: 'error', history: [], error: 'CUDA out of memory' })
  })

  it('moves to a "connection lost" error state if the socket closes before a terminal event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    act(() => socket.onclose?.())

    expect(result.current).toEqual({ status: 'error', history: [], error: 'connection lost' })
  })

  it('does not overwrite an already-terminal state when the server closes the socket afterward', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'complete', metrics: {} })
    act(() => socket.onclose?.())

    expect(result.current).toEqual({ status: 'complete', history: [], metrics: {} })
  })

  it('closes the socket and ignores further events once unmounted', () => {
    const { unmount } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    unmount()

    expect(socket.close).toHaveBeenCalledOnce()
    expect(() =>
      send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.1, val_loss: 0.1 }),
    ).not.toThrow()
  })
})
