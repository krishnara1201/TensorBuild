import type { EdgeSpec, NodeManifest, NodeSpec, PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { VMB_FILE_VERSION, type FromVmbResult, type VmbProjectFile } from './types'

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

export function toVmbFile(nodes: PipelineNode[], edges: PipelineEdge[]): VmbProjectFile {
  const layout: VmbProjectFile['layout'] = {}
  for (const node of nodes) {
    layout[node.id] = { x: node.position.x, y: node.position.y }
  }
  return { version: VMB_FILE_VERSION, ir: toIR(nodes, edges), layout }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitRef(ref: string): { id: string; port: string } {
  const dotIndex = ref.lastIndexOf('.')
  return { id: ref.slice(0, dotIndex), port: ref.slice(dotIndex + 1) }
}

export function fromVmbFile(raw: unknown, manifests: NodeManifest[]): FromVmbResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'This file is not a valid TensorBuild project (not a JSON object).' }
  }

  const { version, ir, layout } = raw as { version?: unknown; ir?: unknown; layout?: unknown }

  if (typeof version !== 'number') {
    return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
  }
  if (version !== VMB_FILE_VERSION) {
    return {
      ok: false,
      error: `Unsupported project file version ${version} (this build supports version ${VMB_FILE_VERSION}).`,
    }
  }
  if (!isPlainObject(ir) || !Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) {
    return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
  }

  const layoutMap: VmbProjectFile['layout'] = isPlainObject(layout) ? (layout as VmbProjectFile['layout']) : {}
  const irNodes = ir.nodes as NodeSpec[]
  const irEdges = ir.edges as EdgeSpec[]

  // Validate each node has the required shape
  for (const node of irNodes) {
    if (!isPlainObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string') {
      return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
    }
  }

  // Validate each edge has the required shape
  for (const edge of irEdges) {
    if (!isPlainObject(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
    }
  }

  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const missingTypes = [...new Set(irNodes.map((node) => node.type).filter((type) => !manifestById.has(type)))]
  if (missingTypes.length > 0) {
    return { ok: false, error: `Unknown node types: ${missingTypes.join(', ')}` }
  }

  const nodes: PipelineNode[] = irNodes.map((node) => ({
    id: node.id,
    type: 'pipelineNode',
    position: layoutMap[node.id] ?? { x: 0, y: 0 },
    data: {
      manifest: manifestById.get(node.type)!,
      params: node.params,
    },
  }))

  const edges: PipelineEdge[] = irEdges.map((edge) => {
    const from = splitRef(edge.from)
    const to = splitRef(edge.to)
    return {
      id: `${from.id}:${from.port}->${to.id}:${to.port}`,
      source: from.id,
      sourceHandle: from.port,
      target: to.id,
      targetHandle: to.port,
    }
  })

  return { ok: true, nodes, edges }
}
