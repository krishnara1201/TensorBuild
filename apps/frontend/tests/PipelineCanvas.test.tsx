import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Position } from '@xyflow/react'
import { PipelineCanvas } from '../src/canvas/PipelineCanvas'
import * as client from '../src/api/client'
import type { PipelineEdge, PipelineNode } from '../src/canvas/types'
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

  it('shows a delete button on an edge that removes it via onEdgesChange', async () => {
    // React Flow tracks handle positions via getBoundingClientRect, which
    // jsdom always reports as all-zero; without a concrete rect the edge
    // renderer treats the edge as unmeasured and skips it entirely.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 140,
      height: 56,
      top: 0,
      left: 0,
      right: 140,
      bottom: 56,
      toJSON: () => {},
    })

    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)

    // React Flow only renders an edge once both endpoint nodes are
    // "initialized" — measured dimensions plus handle bounds. jsdom never
    // reports either via layout, so supply both directly to skip that wait.
    const nodeA: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
      measured: { width: 140, height: 56 },
      handles: [{ id: 'table', type: 'source', position: Position.Right, x: 140, y: 24, width: 1, height: 1 }],
    }
    const nodeB: PipelineNode = {
      id: 'n2',
      type: 'pipelineNode',
      position: { x: 200, y: 0 },
      data: { manifest: csvManifest, params: {} },
      measured: { width: 140, height: 56 },
      handles: [{ id: 'table', type: 'target', position: Position.Left, x: 0, y: 24, width: 1, height: 1 }],
    }
    const edge: PipelineEdge = { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'table', targetHandle: 'table' }

    const onEdgesChange = vi.fn()
    render(
      <PipelineCanvas
        nodes={[nodeA, nodeB]}
        edges={[edge]}
        onNodesChange={noop}
        onEdgesChange={onEdgesChange}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const deleteButton = await screen.findByRole('button', { name: /delete connection/i })
    await userEvent.click(deleteButton)

    expect(onEdgesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'remove', id: 'e1' })]),
    )
  })
})
