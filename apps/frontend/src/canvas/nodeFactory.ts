import type { NodeManifest } from '../api/types'
import type { PipelineNode } from './types'

export function defaultsFromManifest(manifest: NodeManifest): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const param of manifest.params) {
    params[param.name] = param.default
  }
  return params
}

export function createPipelineNode(
  manifest: NodeManifest,
  id: string,
  position: { x: number; y: number },
): PipelineNode {
  return {
    id,
    type: 'pipelineNode',
    position,
    data: {
      manifest,
      params: defaultsFromManifest(manifest),
    },
  }
}

const NODE_ID_PATTERN = /^n(\d+)$/

export function nextNodeId(nodes: PipelineNode[]): string {
  const maxSuffix = nodes.reduce((max, node) => {
    const match = NODE_ID_PATTERN.exec(node.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `n${maxSuffix + 1}`
}
