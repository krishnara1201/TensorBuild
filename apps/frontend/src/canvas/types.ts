import type { Edge, Node } from '@xyflow/react'
import type { NodeManifest } from '../api/types'

export type NodeRunStatus = 'idle' | 'running' | 'success' | 'error'

export interface PipelineNodeData extends Record<string, unknown> {
  manifest: NodeManifest
  params: Record<string, unknown>
  status?: NodeRunStatus
}

export type PipelineNode = Node<PipelineNodeData>
export type PipelineEdge = Edge
