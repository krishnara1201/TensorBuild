import {
  addEdge,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodeConnections,
  Handle,
  Position,
  type Connection,
  type EdgeProps,
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

const PORT_TOP_OFFSET = 32
const PORT_ROW_HEIGHT = 16
const NODE_MIN_HEIGHT_PADDING = 16

// Per-port-type accent color, shared by handles and the edges connecting
// them, so a pipeline's data-vs-layer-vs-model wiring is visually
// distinguishable at a glance. rgb() (not hex) so the color read back off
// the DOM in tests matches exactly what was set, independent of any
// hex-to-rgb normalization jsdom's style engine may or may not do.
const PORT_TYPE_COLORS: Record<string, string> = {
  Table: 'rgb(74, 144, 217)',
  Layer: 'rgb(155, 89, 182)',
  Model: 'rgb(46, 204, 113)',
  Metrics: 'rgb(230, 126, 34)',
  ImageBatch: 'rgb(231, 76, 60)',
}
const DEFAULT_PORT_COLOR = 'rgb(136, 136, 136)'

function colorForPortType(portType: string | undefined): string {
  if (!portType) return DEFAULT_PORT_COLOR
  return PORT_TYPE_COLORS[portType] ?? DEFAULT_PORT_COLOR
}

export function outputPortTypeForConnection(
  connection: Connection,
  nodes: PipelineNode[],
): string | undefined {
  const sourceNode = nodes.find((node) => node.id === connection.source)
  return sourceNode?.data.manifest.outputs.find((port) => port.name === connection.sourceHandle)?.type
}

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
        style={{ top, background: colorForPortType(port.type) }}
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
      <Handle
        id={port.name}
        type="source"
        position={Position.Right}
        style={{ top, background: colorForPortType(port.type) }}
      />
      <span className="pipeline-node-port-label pipeline-node-port-label-source" style={{ top }}>
        {port.name}
      </span>
    </>
  )
}

function PipelineNodeRenderer({ id, data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  const { deleteElements } = useReactFlow()
  const portRows = Math.max(manifest.inputs.length, manifest.outputs.length, 1)
  const minHeight = PORT_TOP_OFFSET + portRows * PORT_ROW_HEIGHT + NODE_MIN_HEIGHT_PADDING
  return (
    <div className="pipeline-node" style={{ minHeight }}>
      <button
        type="button"
        aria-label="Delete node"
        className="node-delete-button nodrag nopan"
        onClick={(event) => {
          event.stopPropagation()
          void deleteElements({ nodes: [{ id }] })
        }}
      >
        ×
      </button>
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

function DeleteableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const portType = typeof data?.portType === 'string' ? data.portType : undefined

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: colorForPortType(portType) }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="Delete connection"
          className="edge-delete-button nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={(event) => {
            event.stopPropagation()
            void deleteElements({ edges: [{ id }] })
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

const NODE_TYPES = { pipelineNode: PipelineNodeRenderer }
const EDGE_TYPES = { deleteable: DeleteableEdge }

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
      const portType = outputPortTypeForConnection(connection, nodes)
      setEdges((eds) => {
        const nextEdges = addEdge(connection, eds)
        const newEdge = nextEdges[nextEdges.length - 1]
        return nextEdges.map((edge) =>
          edge === newEdge ? { ...edge, data: { ...edge.data, portType } } : edge,
        )
      })
    },
    [nodes, setEdges],
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
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={{ type: 'deleteable' }}
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
