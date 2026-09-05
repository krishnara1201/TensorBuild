import type { PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'

export const VMB_FILE_VERSION = 1

export type VmbLayout = Record<string, { x: number; y: number }>

export interface VmbProjectFile {
  version: number
  ir: PipelineIR
  layout: VmbLayout
}

export type FromVmbResult =
  | { ok: true; nodes: PipelineNode[]; edges: PipelineEdge[] }
  | { ok: false; error: string }
