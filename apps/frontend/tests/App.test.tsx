import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { App } from '../src/App'
import * as client from '../src/api/client'
import * as trainingRun from '../src/training/useTrainingRun'

// Vitest hoists `vi.mock(...)` calls above regular imports/declarations, so
// a mutable flag referenced inside a factory must be created via
// `vi.hoisted` — a plain `let` declared below would still be in its
// temporal dead zone when the hoisted factory first runs.
const stubNodeFlag = vi.hoisted(() => ({ shouldInject: false }))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn(), useRunPipeline: vi.fn(), useGetCode: vi.fn(), previewSubgraph: vi.fn() }
})

const { saveProjectMock, saveProjectAsMock, openProjectMock } = vi.hoisted(() => ({
  saveProjectMock: vi.fn(),
  saveProjectAsMock: vi.fn(),
  openProjectMock: vi.fn(),
}))

vi.mock('../src/persistence/vmbIo', () => ({
  saveProject: saveProjectMock,
  saveProjectAs: saveProjectAsMock,
  openProject: openProjectMock,
}))

vi.mock('../src/persistence/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: vi.fn(),
}))

vi.mock('../src/training/useTrainingRun', async () => {
  const actual = await vi.importActual<typeof import('../src/training/useTrainingRun')>(
    '../src/training/useTrainingRun',
  )
  return { ...actual, useTrainingRun: vi.fn() }
})

vi.mock('../src/inspector/InspectorPanel', () => ({
  InspectorPanel: ({ onPreview }: { onPreview: (nodeId: string, port: string) => void }) => (
    <button type="button" onClick={() => onPreview('n1', 'table')}>
      Fake preview trigger
    </button>
  ),
}))

// Stub out the real canvas (ReactFlow) so we can (a) inject a single fake
// node into App's real `nodes` state via the real `setNodes` prop it's
// given, on demand via `stubNodeFlag.shouldInject`, and (b) read back the
// exact `nodeStatuses` map App computed for that node — the thing Fix #5
// (sync-run glow) actually changes. Only the dedicated glow test below
// turns injection on; every other test leaves it off (empty canvas, as
// before this mock existed).
vi.mock('../src/canvas/PipelineCanvas', () => ({
  PipelineCanvas: ({
    nodeStatuses,
    setNodes,
    onNodesChange,
    onEdgesChange,
  }: {
    nodeStatuses: Record<string, string>
    setNodes: (nodes: unknown[]) => void
    onNodesChange: (changes: Array<{ type: string; id: string }>) => void
    onEdgesChange: (changes: Array<{ type: string; id: string }>) => void
  }) => {
    useEffect(() => {
      if (stubNodeFlag.shouldInject) {
        setNodes([
          {
            id: 'n1',
            type: 'pipelineNode',
            position: { x: 0, y: 0 },
            data: {
              manifest: {
                id: 'data.csv_loader',
                category: 'Data',
                label: 'CSV Loader',
                inputs: [],
                outputs: [],
                params: [],
                long_running: false,
              },
              params: {},
            },
          },
        ])
      }
      // Run once per mount only.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <div data-testid="canvas-stub">
        {Object.entries(nodeStatuses).map(([id, status]) => (
          <div key={id} data-testid={`node-status-${id}`}>{`${id}:${status}`}</div>
        ))}
        <button
          type="button"
          onClick={() => onNodesChange([{ type: 'select', id: 'n1', selected: true } as never])}
        >
          Fire node select change
        </button>
        <button type="button" onClick={() => onNodesChange([{ type: 'dimensions', id: 'n1' } as never])}>
          Fire node dimensions change
        </button>
        <button type="button" onClick={() => onNodesChange([{ type: 'position', id: 'n1' } as never])}>
          Fire node position change
        </button>
        <button type="button" onClick={() => onNodesChange([{ type: 'remove', id: 'n1' } as never])}>
          Fire node remove change
        </button>
        <button
          type="button"
          onClick={() => onEdgesChange([{ type: 'select', id: 'e1', selected: true } as never])}
        >
          Fire edge select change
        </button>
        <button type="button" onClick={() => onEdgesChange([{ type: 'remove', id: 'e1' } as never])}>
          Fire edge remove change
        </button>
      </div>
    )
  },
}))

function mockMutation(overrides: Partial<ReturnType<typeof client.useRunPipeline>>) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    data: undefined,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof client.useRunPipeline>
}

describe('App', () => {
  beforeEach(() => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)
    vi.mocked(trainingRun.useTrainingRun).mockReturnValue({ status: 'connecting', history: [] })
  })

  afterEach(() => {
    stubNodeFlag.shouldInject = false
    saveProjectMock.mockReset()
    saveProjectAsMock.mockReset()
    openProjectMock.mockReset()
  })

  it('renders the app heading', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByRole('heading', { name: /tensorbuild/i })).toBeInTheDocument()
  })

  it('calls the run mutation with the current (empty) pipeline IR when Run is clicked', async () => {
    const runMutate = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(runMutate).toHaveBeenCalledWith(
      { nodes: [], edges: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('shows the run error message when the run mutation fails', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ error: new Error('unknown node type') }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText('unknown node type')).toBeInTheDocument()
  })

  it('shows the codegen error message when the get-code mutation fails', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ error: new Error('codegen exploded') }))

    render(<App />)

    expect(screen.getByText('codegen exploded')).toBeInTheDocument()
  })

  it('renders returned metrics on a successful synchronous run', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(
      mockMutation({ data: { kind: 'sync', metrics: { 'n4.metrics': { accuracy: 0.95 } } } }),
    )
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText('n4')).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9500')).toBeInTheDocument()
  })

  it('shows a "Running…" state and a training heading in the visualizations panel when the run mutation returns an async outcome', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
    expect(screen.getByText('Training…')).toBeInTheDocument()
  })

  it('opens the code view panel after a successful codegen call', async () => {
    const getCodeMutate = vi.fn((_ir, options?: { onSuccess?: () => void }) => options?.onSuccess?.())
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(
      mockMutation({ mutate: getCodeMutate, data: { code: 'print(1)' } }),
    )

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /view code/i }))

    expect(screen.getByText('Generated Code')).toBeInTheDocument()
  })

  it('switches to the Data Preview tab and shows preview data when Preview is triggered from the inspector', async () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))

    expect(await screen.findByText('Showing 0 of 0 rows')).toBeInTheDocument()
  })

  it('shows async run completion metrics (from the training WebSocket) on the Results tab', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(trainingRun.useTrainingRun).mockReturnValue({
      status: 'complete',
      history: [],
      metrics: { 'n5.metrics': { accuracy: 0.87 } },
    })

    render(<App />)

    expect(screen.getByText('n5')).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.8700')).toBeInTheDocument()
  })

  it('shows a streamed training error (node_error/connection lost) on the Results tab', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(trainingRun.useTrainingRun).mockReturnValue({
      status: 'error',
      history: [],
      error: 'node explode',
      nodeId: 'n3',
    })

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.getByText('node explode')).toBeInTheDocument()
  })

  it('resets activeRunId when a new run starts, so a stale training section from a prior async run does not persist', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(trainingRun.useTrainingRun).mockReturnValue({ status: 'complete', history: [], metrics: {} })

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))
    expect(screen.getByText('Training complete')).toBeInTheDocument()

    // A fresh run — this time resolving synchronously, like a plain
    // sklearn/data pipeline — must clear activeRunId as its first action,
    // otherwise the previous async run's training section stays visible
    // even though no async run is active anymore.
    runMutate.mockImplementationOnce(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'sync'; metrics: Record<string, unknown> }) => void }) =>
        options?.onSuccess?.({ kind: 'sync', metrics: {} }),
    )
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.queryByText('Training complete')).not.toBeInTheDocument()
  })

  it('clicking New does nothing else and does not prompt when the canvas is clean', async () => {
    const runMutate = vi.fn()
    const runReset = vi.fn()
    const codeReset = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm')
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate, reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(runReset).toHaveBeenCalled()
    expect(codeReset).toHaveBeenCalled()
  })

  it('New prompts for confirmation once the canvas is dirty, and does nothing if cancelled', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(window.confirm).toHaveBeenCalledWith('New project? This clears all nodes and results.')
    expect(runReset).not.toHaveBeenCalled()
    expect(codeReset).not.toHaveBeenCalled()
  })

  it('clears run/code mutation state and returns to the Results tab after New is confirmed on a dirty canvas', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))
    expect(await screen.findByRole('tab', { name: /data preview/i })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(runReset).toHaveBeenCalled()
    expect(codeReset).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /^results$/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('marks every canvas node "running" while a synchronous run is pending, and clears it once settled', () => {
    stubNodeFlag.shouldInject = true
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ isPending: true }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    const { rerender } = render(<App />)

    expect(screen.getByTestId('node-status-n1')).toHaveTextContent('n1:running')

    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ isPending: false }))
    rerender(<App />)

    expect(screen.queryByTestId('node-status-n1')).not.toBeInTheDocument()
  })

  it('saves to the remembered path on Save, and shows the filename once one exists', async () => {
    saveProjectMock.mockResolvedValue({ ok: true, path: '/home/user/pipeline.vmb' })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(saveProjectMock).toHaveBeenCalledWith(
      { version: 1, ir: { nodes: [], edges: [] }, layout: {} },
      null,
    )
    expect(await screen.findByText('pipeline.vmb')).toBeInTheDocument()
  })

  it('Save As always prompts, even when a current path is already set', async () => {
    saveProjectMock.mockResolvedValue({ ok: true, path: '/home/user/pipeline.vmb' })
    saveProjectAsMock.mockResolvedValue({ ok: true, path: '/home/user/renamed.vmb' })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByText('pipeline.vmb')
    await userEvent.click(screen.getByRole('button', { name: /^save as$/i }))

    expect(saveProjectAsMock).toHaveBeenCalled()
    expect(await screen.findByText('renamed.vmb')).toBeInTheDocument()
  })

  it('loads nodes/edges from Open and shows the opened filename', async () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [
        {
          id: 'data.csv_loader',
          category: 'Data',
          label: 'CSV Loader',
          inputs: [],
          outputs: [{ name: 'table', type: 'Table' }],
          params: [],
          long_running: false,
        },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    openProjectMock.mockResolvedValue({
      ok: true,
      path: '/home/user/loaded.vmb',
      raw: {
        version: 1,
        ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
        layout: { n1: { x: 5, y: 5 } },
      },
    })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(await screen.findByText('loaded.vmb')).toBeInTheDocument()
  })

  it('shows an error banner and leaves the canvas unchanged when Open fails validation', async () => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)
    openProjectMock.mockResolvedValue({
      ok: true,
      path: '/home/user/broken.vmb',
      raw: { version: 1, ir: { nodes: [{ id: 'n1', type: 'unknown.node', params: {} }], edges: [] }, layout: {} },
    })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(await screen.findByText('Unknown node types: unknown.node')).toBeInTheDocument()
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('Open confirms before discarding a dirty canvas, and does nothing if cancelled', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(window.confirm).toHaveBeenCalledWith('You have unsaved changes. Open a different project anyway?')
    expect(openProjectMock).not.toHaveBeenCalled()
  })

  it('does not mark the canvas dirty on a non-mutating "select" or "dimensions" node change', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    confirmSpy.mockClear()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /fire node select change/i }))
    await userEvent.click(screen.getByRole('button', { name: /fire node dimensions change/i }))
    await userEvent.click(screen.getByRole('button', { name: /fire edge select change/i }))
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('marks the canvas dirty on a mutating "position" or "remove" node/edge change', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /fire node position change/i }))
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(window.confirm).toHaveBeenCalledWith('New project? This clears all nodes and results.')
  })

  it('marks the canvas dirty on a "remove" edge change', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /fire edge remove change/i }))
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(window.confirm).toHaveBeenCalledWith('New project? This clears all nodes and results.')
  })

  it('shows the error message in the banner when Save fails', async () => {
    saveProjectMock.mockResolvedValue({ ok: false, error: 'disk full' })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('disk full')).toBeInTheDocument()
  })

  it('shows "Node registry not loaded yet" instead of an unknown-type error when manifests have not loaded', async () => {
    vi.mocked(client.useNodes).mockReturnValue({ data: undefined, isLoading: true, error: null } as ReturnType<
      typeof client.useNodes
    >)
    openProjectMock.mockResolvedValue({
      ok: true,
      path: '/home/user/loaded.vmb',
      raw: {
        version: 1,
        ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
        layout: {},
      },
    })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(await screen.findByText('Node registry not loaded yet — is the engine running?')).toBeInTheDocument()
    expect(screen.queryByText(/unknown node types/i)).not.toBeInTheDocument()
  })
})
