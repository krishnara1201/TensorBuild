import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import * as client from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn(), useRunPipeline: vi.fn(), useGetCode: vi.fn(), previewSubgraph: vi.fn() }
})

vi.mock('../src/training/TrainingMonitor', () => ({
  TrainingMonitor: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div>
      <p>Training monitor for {runId}</p>
      <button type="button" onClick={onClose}>
        Close training monitor
      </button>
    </div>
  ),
}))

vi.mock('../src/inspector/InspectorPanel', () => ({
  InspectorPanel: ({ onPreview }: { onPreview: (nodeId: string, port: string) => void }) => (
    <button type="button" onClick={() => onPreview('n1', 'table')}>
      Fake preview trigger
    </button>
  ),
}))

function mockMutation(overrides: Partial<ReturnType<typeof client.useRunPipeline>>) {
  return {
    mutate: vi.fn(),
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
  })

  it('renders the app heading', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByRole('heading', { name: /visual model builder/i })).toBeInTheDocument()
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

  it('renders returned metrics on a successful synchronous run', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(
      mockMutation({ data: { kind: 'sync', metrics: { 'n4.metrics': { accuracy: 0.95 } } } }),
    )
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9500')).toBeInTheDocument()
  })

  it('opens the training monitor when the run mutation returns an async outcome', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.getByText('Training monitor for run-1')).toBeInTheDocument()
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
})
