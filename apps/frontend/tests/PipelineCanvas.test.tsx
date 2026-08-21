import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineCanvas } from '../src/canvas/PipelineCanvas'
import * as client from '../src/api/client'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest } from '../src/api/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn() }
})

const csvManifest: NodeManifest = {
  id: 'data.csv_loader',
  category: 'Data',
  label: 'CSV Loader',
  inputs: [],
  outputs: [{ name: 'table', type: 'Table' }],
  params: [],
  long_running: false,
}

function noop() {}

describe('PipelineCanvas', () => {
  it('renders the React Flow pane with no nodes', () => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)

    const { container } = render(
      <PipelineCanvas
        nodes={[]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    expect(container.querySelector('.react-flow')).not.toBeNull()
  })

  it('renders a node label for a node already on the canvas', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const existingNode: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
    }

    render(
      <PipelineCanvas
        nodes={[existingNode]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    expect(screen.getByText('CSV Loader')).toBeInTheDocument()
  })
})
