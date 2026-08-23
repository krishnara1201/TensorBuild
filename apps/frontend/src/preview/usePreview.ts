import { useCallback, useRef, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PipelineIR, PreviewResult } from '../api/types'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: PreviewResult }
  | { status: 'error'; error: string }

export function usePreview() {
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  // Same pattern as `requestIdRef` in `useDynamicOptions`: guards against a
  // slow earlier request (e.g. previewing node A) resolving after a later
  // request (previewing node B) has already landed, which would otherwise
  // silently overwrite B's displayed result with A's stale one.
  const requestIdRef = useRef(0)

  const runPreview = useCallback((ir: PipelineIR, nodeId: string, port: string) => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })
    previewSubgraph(ir, nodeId, port)
      .then((data) => {
        if (requestIdRef.current !== requestId) return
        setState({ status: 'success', data })
      })
      .catch((error: Error) => {
        if (requestIdRef.current !== requestId) return
        setState({ status: 'error', error: error.message })
      })
  }, [])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, runPreview, reset }
}
