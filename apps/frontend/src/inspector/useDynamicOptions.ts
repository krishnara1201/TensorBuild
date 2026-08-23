import { useEffect, useRef, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PreviewResult } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { toIR } from '../ir/convert'
import type { DynamicOptionsState } from './params/types'

export function useDynamicOptions(
  node: PipelineNode | null,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Record<string, DynamicOptionsState> {
  const [state, setState] = useState<Record<string, DynamicOptionsState>>({})
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map<string, PreviewResult>())
  const lastSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    const dynamicParams = node?.data.manifest.params.filter((spec) => spec.options_source) ?? []
    if (!node || dynamicParams.length === 0) {
      // Only actually clear state (and thus trigger a re-render) the first
      // time we see "no dynamic params" for this node — nodes/edges are
      // fresh array literals on every caller re-render, so without this
      // guard this branch would call setState on every render forever.
      if (lastSignatureRef.current !== 'none') {
        lastSignatureRef.current = 'none'
        setState({})
      }
      return
    }

    const ir = toIR(nodes, edges)
    const irKey = JSON.stringify(ir)
    const signature = `${node.id}::${irKey}`
    if (signature === lastSignatureRef.current) {
      // Same node + same pipeline shape as last run — nodes/edges may be
      // new array references (callers often don't memoize them), but
      // nothing actually changed, so skip re-deriving state. Without this,
      // every setState call below would trigger a re-render, which (since
      // deps are reference-unstable) re-runs this effect, which calls
      // setState again — an infinite loop.
      return
    }
    lastSignatureRef.current = signature

    const requestId = ++requestIdRef.current
    const initialState: Record<string, DynamicOptionsState> = {}
    const toFetch: { paramName: string; sourceNodeId: string; sourcePort: string; cacheKey: string }[] = []

    for (const spec of dynamicParams) {
      const inputPort = spec.options_source!.input_port
      const edge = edges.find((e) => e.target === node.id && e.targetHandle === inputPort)
      if (!edge || !edge.sourceHandle) {
        initialState[spec.name] = { status: 'disconnected' }
        continue
      }
      const cacheKey = `${edge.source}.${edge.sourceHandle}::${irKey}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        initialState[spec.name] = { status: 'ready', options: cached.columns.map((c) => c.name) }
      } else {
        initialState[spec.name] = { status: 'loading' }
        toFetch.push({ paramName: spec.name, sourceNodeId: edge.source, sourcePort: edge.sourceHandle, cacheKey })
      }
    }
    setState(initialState)

    for (const { paramName, sourceNodeId, sourcePort, cacheKey } of toFetch) {
      previewSubgraph(ir, sourceNodeId, sourcePort)
        .then((result) => {
          cacheRef.current.set(cacheKey, result)
          if (requestIdRef.current !== requestId) return
          setState((prev) => ({
            ...prev,
            [paramName]: { status: 'ready', options: result.columns.map((c) => c.name) },
          }))
        })
        .catch((error: Error) => {
          if (requestIdRef.current !== requestId) return
          setState((prev) => ({ ...prev, [paramName]: { status: 'error', message: error.message } }))
        })
    }
  }, [node, nodes, edges])

  return state
}
