import type { PipelineNode } from './types'

export interface ConnectionLike {
  source: string | null
  sourceHandle?: string | null
  target: string | null
  targetHandle?: string | null
}

export function isValidConnection(connection: ConnectionLike, nodes: PipelineNode[]): boolean {
  const { source, sourceHandle, target, targetHandle } = connection
  if (!source || !target || !sourceHandle || !targetHandle) {
    return false
  }
  if (source === target) {
    return false
  }

  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)
  if (!sourceNode || !targetNode) {
    return false
  }

  const outputPort = sourceNode.data.manifest.outputs.find((port) => port.name === sourceHandle)
  const inputPort = targetNode.data.manifest.inputs.find((port) => port.name === targetHandle)
  if (!outputPort || !inputPort) {
    return false
  }

  return outputPort.type === inputPort.type
}
