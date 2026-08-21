import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { useNodes } from '../api/client'
import { createPipelineNode } from './nodeFactory'
import type { PipelineEdge, PipelineNode, PipelineNodeData } from './types'
import { isValidConnection as validateConnection } from './validation'

function PipelineNodeRenderer({ data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  return (
    <div className="pipeline-node">
      <div>{manifest.label}</div>
      {manifest.inputs.map((port, index) => (
        <Handle key={port.name} id={port.name} type="target" position={Position.Left} style={{ top: 24 + index * 16 }} />
      ))}
      {manifest.outputs.map((port, index) => (
        <Handle key={port.name} id={port.name} type="source" position={Position.Right} style={{ top: 24 + index * 16 }} />
      ))}
    </div>
  )
}

const NODE_TYPES = { pipelineNode: PipelineNodeRenderer }

export interface PipelineCanvasProps {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  onNodesChange: OnNodesChange<PipelineNode>
  onEdgesChange: OnEdgesChange<PipelineEdge>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setEdges: Dispatch<SetStateAction<PipelineEdge[]>>
  onSelectNode: (nodeId: string | null) => void
}

function PipelineCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
}: PipelineCanvasProps) {
  const { data: manifests } = useNodes()
  const { screenToFlowPosition } = useReactFlow()
  const nodeIdCounter = useRef(0)

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => [
        ...eds,
        {
          id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
          source: connection.source,
          sourceHandle: connection.sourceHandle,
          target: connection.target,
          targetHandle: connection.targetHandle,
        },
      ])
    },
    [setEdges],
  )

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const manifestId = event.dataTransfer.getData('application/vmb-node-type')
      const manifest = manifests?.find((m) => m.id === manifestId)
      if (!manifest) {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      nodeIdCounter.current += 1
      const newNode = createPipelineNode(manifest, `n${nodeIdCounter.current}`, position)
      setNodes((nds) => [...nds, newNode])
    },
    [manifests, screenToFlowPosition, setNodes],
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="pipeline-canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={(connection) => validateConnection(connection, nodes)}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
