import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePreview } from '../src/preview/usePreview'
import * as client from '../src/api/client'
import type { PipelineIR } from '../src/api/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, previewSubgraph: vi.fn() }
})

const ir: PipelineIR = { nodes: [], edges: [] }

describe('usePreview', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => usePreview())
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('moves to loading then success', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({
      columns: [{ name: 'a', dtype: 'int64' }],
      rows: [[1]],
      total_rows: 1,
    })
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })
    expect(result.current.state).toEqual({ status: 'loading' })

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'success',
        data: { columns: [{ name: 'a', dtype: 'int64' }], rows: [[1]], total_rows: 1 },
      })
    })
  })

  it('moves to error on failure', async () => {
    vi.mocked(client.previewSubgraph).mockRejectedValueOnce(new Error('bad path'))
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', error: 'bad path' })
    })
  })

  it('ignores a stale first response that resolves after a second request', async () => {
    let resolveFirst!: (value: { columns: []; rows: []; total_rows: number }) => void
    const first = new Promise<{ columns: []; rows: []; total_rows: number }>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(client.previewSubgraph).mockReturnValueOnce(first)
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({
      columns: [{ name: 'b', dtype: 'int64' }],
      rows: [[2]],
      total_rows: 1,
    })
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })
    act(() => {
      result.current.runPreview(ir, 'n2', 'table')
    })

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'success',
        data: { columns: [{ name: 'b', dtype: 'int64' }], rows: [[2]], total_rows: 1 },
      })
    })

    // The first request resolves last — it must NOT clobber the second
    // request's already-displayed result.
    await act(async () => {
      resolveFirst({ columns: [], rows: [], total_rows: 0 })
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({
      status: 'success',
      data: { columns: [{ name: 'b', dtype: 'int64' }], rows: [[2]], total_rows: 1 },
    })
  })

  it('reset returns to idle', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({ columns: [], rows: [], total_rows: 0 })
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })
    await waitFor(() => expect(result.current.state.status).toBe('success'))

    act(() => {
      result.current.reset()
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })
})
