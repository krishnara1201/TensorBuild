import { useCallback, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { useGetCode, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { toIR } from './ir/convert'
import { MetricsView } from './metrics/MetricsView'
import { NodePalette } from './palette/NodePalette'
import { PreviewPanel } from './preview/PreviewPanel'
import { usePreview } from './preview/usePreview'
import { TrainingMonitor } from './training/TrainingMonitor'

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ nodeId: string; port: string } | null>(null)
  const preview = usePreview()

  const runMutation = useRunPipeline()
  const codeMutation = useGetCode()

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const handleParamChange = useCallback(
    (nodeId: string, paramName: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, params: { ...node.data.params, [paramName]: value } } }
            : node,
        ),
      )
    },
    [setNodes],
  )

  const handleRun = useCallback(() => {
    runMutation.mutate(toIR(nodes, edges), {
      onSuccess: (outcome) => {
        if (outcome.kind === 'async') {
          setActiveRunId(outcome.runId)
        }
      },
    })
  }, [nodes, edges, runMutation])

  const handleViewCode = useCallback(() => {
    codeMutation.mutate(toIR(nodes, edges), {
      onSuccess: () => setCodeViewOpen(true),
    })
  }, [nodes, edges, codeMutation])

  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setPreviewTarget({ nodeId, port })
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const handleClosePreview = useCallback(() => {
    setPreviewTarget(null)
    preview.reset()
  }, [preview])

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Visual Model Builder</h1>
        <button type="button" onClick={handleRun} disabled={runMutation.isPending}>
          {runMutation.isPending ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      {runMutation.error && <p className="error-banner">{runMutation.error.message}</p>}
      {runMutation.data?.kind === 'sync' && (
        <div className="metrics-list">
          {Object.entries(runMutation.data.metrics).map(([ref, value]) => (
            <div key={ref} className="metrics-block">
              <h3 className="metrics-block-heading">{ref}</h3>
              <MetricsView metrics={value as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}
      {codeMutation.error && <p className="error-banner">{codeMutation.error.message}</p>}

      <div className="app-body">
        <NodePalette />
        <PipelineCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={setSelectedNodeId}
        />
        <InspectorPanel
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          onParamChange={handleParamChange}
          onPreview={handlePreview}
        />
      </div>

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
      {activeRunId && <TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />}
      {previewTarget && <PreviewPanel state={preview.state} onClose={handleClosePreview} />}
    </div>
  )
}
