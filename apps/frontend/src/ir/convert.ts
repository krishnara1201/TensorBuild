import type { EdgeSpec, NodeSpec, PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'

export function toIR(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineIR {
  const irNodes: NodeSpec[] = nodes.map((node) => ({
    id: node.id,
    type: node.data.manifest.id,
    params: node.data.params,
  }))

  const irEdges: EdgeSpec[] = edges.map((edge) => {
    if (!edge.sourceHandle || !edge.targetHandle) {
      throw new Error(`edge ${edge.id} is missing a source or target handle`)
    }
    return {
      from: `${edge.source}.${edge.sourceHandle}`,
      to: `${edge.target}.${edge.targetHandle}`,
    }
  })

  return { nodes: irNodes, edges: irEdges }
}
