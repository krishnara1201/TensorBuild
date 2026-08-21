import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodeConnections,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import type { Port } from '../api/types'
import { useNodes } from '../api/client'
import { createPipelineNode } from './nodeFactory'
import type { PipelineEdge, PipelineNode, PipelineNodeData } from './types'
import { isValidConnection as validateConnection } from './validation'

const PORT_TOP_OFFSET = 24
const PORT_ROW_HEIGHT = 16
const NODE_MIN_HEIGHT_PADDING = 16

// An input port should only ever hold one incoming edge — the executor
// (engine/vmb_engine/executor.py) overwrites context[port] per edge, so a
// second connection to the same target port silently drops the first with
// no error. useNodeConnections lets React Flow itself refuse a second
// connection at the handle, without teaching validation.ts (a plain,
// library-free port-type-compatibility function) about existing edges.
function TargetPort({ port, top }: { port: Port; top: number }) {
  const connections = useNodeConnections({ handleType: 'target', handleId: port.name })
  return (
    <>
      <Handle
        id={port.name}
        type="target"
        position={Position.Left}
        isConnectableEnd={connections.length === 0}
        style={{ top }}
      />
      <span className="pipeline-node-port-label pipeline-node-port-label-target" style={{ top }}>
        {port.name}
      </span>
    </>
  )
}

function SourcePort({ port, top }: { port: Port; top: number }) {
  return (
    <>
      <Handle id={port.name} type="source" position={Position.Right} style={{ top }} />
      <span className="pipeline-node-port-label pipeline-node-port-label-source" style={{ top }}>
        {port.name}
      </span>
    </>
  )
}

function PipelineNodeRenderer({ data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  const portRows = Math.max(manifest.inputs.length, manifest.outputs.length, 1)
  const minHeight = PORT_TOP_OFFSET + portRows * PORT_ROW_HEIGHT + NODE_MIN_HEIGHT_PADDING
  return (
    <div className="pipeline-node" style={{ minHeight }}>
      <div>{manifest.label}</div>
      {manifest.inputs.map((port, index) => (
        <TargetPort key={port.name} port={port} top={PORT_TOP_OFFSET + index * PORT_ROW_HEIGHT} />
      ))}
      {manifest.outputs.map((port, index) => (
        <SourcePort key={port.name} port={port} top={PORT_TOP_OFFSET + index * PORT_ROW_HEIGHT} />
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
      setEdges((eds) => addEdge(connection, eds))
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
