import { useCallback, useMemo, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { useGetCode, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { toIR } from './ir/convert'
import { AppLayout } from './layout/AppLayout'
import { NodePalette } from './palette/NodePalette'
import { OutputPanel, type OutputTab } from './output/OutputPanel'
import { usePreview } from './preview/usePreview'
import { nodeStatusesFromTrainingState } from './training/nodeStatuses'
import { useTrainingRun } from './training/useTrainingRun'
import { VisualizationsPanel } from './visualizations/VisualizationsPanel'

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [outputTab, setOutputTab] = useState<OutputTab>('results')
  const preview = usePreview()
  const trainingState = useTrainingRun(activeRunId)

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
      setOutputTab('preview')
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const nodeStatuses = useMemo(
    () => (activeRunId ? nodeStatusesFromTrainingState(trainingState) : {}),
    [activeRunId, trainingState],
  )

  const isRunning =
    runMutation.isPending ||
    (activeRunId !== null && (trainingState.status === 'connecting' || trainingState.status === 'running'))

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Visual Model Builder</h1>
        <button type="button" className={isRunning ? 'is-running' : undefined} onClick={handleRun} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      {codeMutation.error && <p className="error-banner">{codeMutation.error.message}</p>}

      <AppLayout
        palette={<NodePalette />}
        canvas={
          <PipelineCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onSelectNode={setSelectedNodeId}
            nodeStatuses={nodeStatuses}
          />
        }
        inspector={
          <InspectorPanel
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onParamChange={handleParamChange}
            onPreview={handlePreview}
          />
        }
        output={
          <OutputPanel
            activeTab={outputTab}
            onTabChange={setOutputTab}
            runMetrics={runMutation.data?.kind === 'sync' ? runMutation.data.metrics : undefined}
            runError={runMutation.error?.message ?? null}
            previewState={preview.state}
          />
        }
        visualizations={
          <VisualizationsPanel
            runMetrics={runMutation.data?.kind === 'sync' ? runMutation.data.metrics : undefined}
            previewData={preview.state.status === 'success' ? preview.state.data : undefined}
            trainingState={activeRunId ? trainingState : undefined}
          />
        }
      />

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
    </div>
  )
}
