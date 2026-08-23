import { useCallback, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PipelineIR, PreviewResult } from '../api/types'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: PreviewResult }
  | { status: 'error'; error: string }

export function usePreview() {
  const [state, setState] = useState<PreviewState>({ status: 'idle' })

  const runPreview = useCallback((ir: PipelineIR, nodeId: string, port: string) => {
    setState({ status: 'loading' })
    previewSubgraph(ir, nodeId, port)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: Error) => setState({ status: 'error', error: error.message }))
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, runPreview, reset }
}
