import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useEdgesState, useNodesState, type OnEdgesChange, type OnNodesChange } from '@xyflow/react'
import { useGetCode, useNodes, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { fromVmbFile, toIR, toVmbFile } from './ir/convert'
import { AppLayout } from './layout/AppLayout'
import { NodePalette } from './palette/NodePalette'
import { OutputPanel, type OutputTab } from './output/OutputPanel'
import { openProject, saveProject, saveProjectAs } from './persistence/vmbIo'
import { useUnsavedChangesGuard } from './persistence/useUnsavedChangesGuard'
import { usePreview } from './preview/usePreview'
import { nodeStatusesFromTrainingState } from './training/nodeStatuses'
import { useTrainingRun } from './training/useTrainingRun'
import { VisualizationsPanel } from './visualizations/VisualizationsPanel'

const MUTATING_NODE_CHANGE_TYPES = new Set(['position', 'remove', 'add', 'replace'])
const MUTATING_EDGE_CHANGE_TYPES = new Set(['remove', 'add', 'replace'])

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [outputTab, setOutputTab] = useState<OutputTab>('results')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const preview = usePreview()
  const trainingState = useTrainingRun(activeRunId)
  const { data: manifests } = useNodes()

  const runMutation = useRunPipeline()
  const codeMutation = useGetCode()

  useUnsavedChangesGuard(isDirty)

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const nodeLabels = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node.data.manifest.label])),
    [nodes],
  )

  const setNodesTracked = useCallback<Dispatch<SetStateAction<PipelineNode[]>>>(
    (update) => {
      setIsDirty(true)
      setNodes(update)
    },
    [setNodes],
  )

  const setEdgesTracked = useCallback<Dispatch<SetStateAction<PipelineEdge[]>>>(
    (update) => {
      setIsDirty(true)
      setEdges(update)
    },
    [setEdges],
  )

  const handleNodesChange = useCallback<OnNodesChange<PipelineNode>>(
    (changes) => {
      if (changes.some((change) => MUTATING_NODE_CHANGE_TYPES.has(change.type))) setIsDirty(true)
      onNodesChange(changes)
    },
    [onNodesChange],
  )

  const handleEdgesChange = useCallback<OnEdgesChange<PipelineEdge>>(
    (changes) => {
      if (changes.some((change) => MUTATING_EDGE_CHANGE_TYPES.has(change.type))) setIsDirty(true)
      onEdgesChange(changes)
    },
    [onEdgesChange],
  )

  const handleParamChange = useCallback(
    (nodeId: string, paramName: string, value: unknown) => {
      setIsDirty(true)
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
    setActiveRunId(null)
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

  const handleNew = useCallback(() => {
    if (isDirty && !window.confirm('New project? This clears all nodes and results.')) return

    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
    setCodeViewOpen(false)
    setActiveRunId(null)
    setOutputTab('results')
    preview.reset()
    runMutation.reset()
    codeMutation.reset()
    setCurrentFilePath(null)
    setProjectError(null)
    setIsDirty(false)
  }, [isDirty, setNodes, setEdges, preview, runMutation, codeMutation])

  const handleSave = useCallback(async () => {
    const result = await saveProject(toVmbFile(nodes, edges), currentFilePath)
    if (!result.ok) {
      if (result.error) setProjectError(result.error)
      return
    }
    if (result.path) setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [nodes, edges, currentFilePath])

  const handleSaveAs = useCallback(async () => {
    const result = await saveProjectAs(toVmbFile(nodes, edges))
    if (!result.ok) {
      if (result.error) setProjectError(result.error)
      return
    }
    if (result.path) setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [nodes, edges])

  const handleOpen = useCallback(async () => {
    if (isDirty && !window.confirm('You have unsaved changes. Open a different project anyway?')) return

    const result = await openProject()
    if (!result.ok) {
      if (result.error) setProjectError(result.error)
      return
    }

    if (!manifests) {
      setProjectError('Node registry not loaded yet — is the engine running?')
      return
    }

    const converted = fromVmbFile(result.raw, manifests)
    if (!converted.ok) {
      setProjectError(converted.error)
      return
    }

    setNodes(converted.nodes)
    setEdges(converted.edges)
    setSelectedNodeId(null)
    setCodeViewOpen(false)
    setActiveRunId(null)
    setOutputTab('results')
    preview.reset()
    runMutation.reset()
    codeMutation.reset()
    setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [isDirty, manifests, setNodes, setEdges, preview, runMutation, codeMutation])

  const isRunning =
    runMutation.isPending ||
    (activeRunId !== null && (trainingState.status === 'connecting' || trainingState.status === 'running'))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (isRunning) return
        void handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, isRunning])

  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setOutputTab('preview')
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const nodeStatuses = useMemo(() => {
    if (activeRunId) return nodeStatusesFromTrainingState(trainingState)
    if (runMutation.isPending) {
      return Object.fromEntries(nodes.map((node) => [node.id, 'running' as const]))
    }
    return {}
  }, [activeRunId, trainingState, runMutation.isPending, nodes])

  const resultMetrics =
    runMutation.data?.kind === 'sync'
      ? runMutation.data.metrics
      : trainingState.status === 'complete'
        ? trainingState.metrics
        : undefined

  const runError =
    runMutation.error?.message ??
    (activeRunId && trainingState.status === 'error' ? trainingState.error : null)

  const projectName = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : 'Untitled'

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>TensorBuild</h1>
        <span className="project-name">
          {isDirty ? '• ' : ''}
          {projectName}
        </span>
        <button type="button" onClick={handleNew} disabled={isRunning}>
          New
        </button>
        <button type="button" onClick={handleOpen} disabled={isRunning}>
          Open
        </button>
        <button type="button" onClick={handleSave} disabled={isRunning}>
          Save
        </button>
        <button type="button" onClick={handleSaveAs} disabled={isRunning}>
          Save As
        </button>
        <button type="button" className={isRunning ? 'is-running' : undefined} onClick={handleRun} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      {projectError && <p className="error-banner">{projectError}</p>}
      {codeMutation.error && <p className="error-banner">{codeMutation.error.message}</p>}

      <AppLayout
        palette={<NodePalette />}
        canvas={
          <PipelineCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            setNodes={setNodesTracked}
            setEdges={setEdgesTracked}
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
            runMetrics={resultMetrics}
            runError={runError}
            previewState={preview.state}
            nodeLabels={nodeLabels}
          />
        }
        visualizations={
          <VisualizationsPanel
            runMetrics={resultMetrics}
            previewData={preview.state.status === 'success' ? preview.state.data : undefined}
            trainingState={activeRunId ? trainingState : undefined}
            nodeLabels={nodeLabels}
          />
        }
      />

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
    </div>
  )
}
