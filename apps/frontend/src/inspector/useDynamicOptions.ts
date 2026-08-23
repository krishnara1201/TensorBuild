import { useEffect, useRef, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PreviewResult } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { toIR } from '../ir/convert'
import type { DynamicOptionsState } from './params/types'

// Mirrors `ancestors_of` in `engine/vmb_engine/executor.py`: walks the edge
// list backwards from `targetNodeId` to find every node that can influence
// its output, including itself. Used to scope a dynamic param's cache
// key/signature (and the actual preview request) to just the pipeline
// upstream of its wired source node — NOT the whole pipeline — so editing
// an unrelated param (or having an unrelated broken downstream branch)
// can't bust the cache or fail the request.
function ancestorNodeIds(nodes: PipelineNode[], edges: PipelineEdge[], targetNodeId: string): Set<string> {
  const incoming = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!incoming.has(edge.target)) incoming.set(edge.target, new Set())
    incoming.get(edge.target)!.add(edge.source)
  }
  const visited = new Set<string>()
  const stack = [targetNodeId]
  while (stack.length > 0) {
    const nodeId = stack.pop()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    for (const parent of incoming.get(nodeId) ?? []) stack.push(parent)
  }
  return visited
}

function dynamicParamsOf(node: PipelineNode | null) {
  return node?.data.manifest.params.filter((spec) => spec.options_source) ?? []
}

// Computes the disconnected/loading state a param would have with no
// upstream fetch resolved yet, so the very first render already reflects
// reality instead of a one-frame "no dynamicOptions prop" flash that would
// make SelectParam briefly render as a plain text input.
function initialStateFor(
  node: PipelineNode | null,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Record<string, DynamicOptionsState> {
  const initial: Record<string, DynamicOptionsState> = {}
  for (const spec of dynamicParamsOf(node)) {
    const inputPort = spec.options_source!.input_port
    const edge = edges.find((e) => e.target === node!.id && e.targetHandle === inputPort)
    initial[spec.name] = !edge || !edge.sourceHandle ? { status: 'disconnected' } : { status: 'loading' }
  }
  return initial
}

export function useDynamicOptions(
  node: PipelineNode | null,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Record<string, DynamicOptionsState> {
  const [state, setState] = useState<Record<string, DynamicOptionsState>>(() =>
    initialStateFor(node, nodes, edges),
  )
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map<string, PreviewResult>())
  const lastSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    const dynamicParams = dynamicParamsOf(node)
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

    // For each dynamic param, scope its signature/cache key/actual request
    // to ONLY the upstream ancestor subgraph of its wired source node — not
    // the full pipeline — so editing an unrelated param (including the
    // selected node's own other params) can't bust the cache or trigger a
    // refetch, and an unrelated broken downstream branch can't fail it.
    const perParam = dynamicParams.map((spec) => {
      const inputPort = spec.options_source!.input_port
      const edge = edges.find((e) => e.target === node.id && e.targetHandle === inputPort)
      if (!edge || !edge.sourceHandle) {
        return { spec, edge: null as null, ir: null, cacheKey: null, signaturePart: `${spec.name}:disconnected` }
      }
      const ancestorIds = ancestorNodeIds(nodes, edges, edge.source)
      const ancestorNodes = nodes.filter((n) => ancestorIds.has(n.id))
      const ancestorEdges = edges.filter((e) => ancestorIds.has(e.source) && ancestorIds.has(e.target))
      const ir = toIR(ancestorNodes, ancestorEdges)
      const irKey = JSON.stringify(ir)
      const cacheKey = `${edge.source}.${edge.sourceHandle}::${irKey}`
      return { spec, edge, ir, cacheKey, signaturePart: `${spec.name}:${cacheKey}` }
    })

    const signature = `${node.id}::${perParam.map((p) => p.signaturePart).join('|')}`
    if (signature === lastSignatureRef.current) {
      // Same node + same upstream ancestor shape for every dynamic param as
      // last run — nodes/edges may be new array references (callers often
      // don't memoize them), but nothing actually changed, so skip
      // re-deriving state. Without this, every setState call below would
      // trigger a re-render, which (since deps are reference-unstable)
      // re-runs this effect, which calls setState again — an infinite loop.
      return
    }
    lastSignatureRef.current = signature

    const requestId = ++requestIdRef.current
    const initialState: Record<string, DynamicOptionsState> = {}
    const toFetch: { paramName: string; sourceNodeId: string; sourcePort: string; cacheKey: string; ir: ReturnType<typeof toIR> }[] = []

    for (const { spec, edge, ir, cacheKey } of perParam) {
      if (!edge || !edge.sourceHandle || !ir || !cacheKey) {
        initialState[spec.name] = { status: 'disconnected' }
        continue
      }
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        initialState[spec.name] = { status: 'ready', options: cached.columns.map((c) => c.name) }
      } else {
        initialState[spec.name] = { status: 'loading' }
        toFetch.push({ paramName: spec.name, sourceNodeId: edge.source, sourcePort: edge.sourceHandle, cacheKey, ir })
      }
    }
    setState(initialState)

    for (const { paramName, sourceNodeId, sourcePort, cacheKey, ir } of toFetch) {
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
