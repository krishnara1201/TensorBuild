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
