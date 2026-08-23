import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Position } from '@xyflow/react'
import { PipelineCanvas, outputPortTypeForConnection } from '../src/canvas/PipelineCanvas'
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

  it('shows a delete button on a node that removes it via onNodesChange', async () => {
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
      // React Flow renders a node visibility:hidden (excluded from the
      // accessibility tree, so findByRole can't see it) until it has
      // measured dimensions; jsdom never reports layout, so supply it
      // directly, matching the edge test above.
      measured: { width: 140, height: 56 },
    }

    const onNodesChange = vi.fn()
    render(
      <PipelineCanvas
        nodes={[existingNode]}
        edges={[]}
        onNodesChange={onNodesChange}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const deleteButton = await screen.findByRole('button', { name: /delete node/i })
    await userEvent.click(deleteButton)

    expect(onNodesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'remove', id: 'n1' })]),
    )
  })
})

describe('outputPortTypeForConnection', () => {
  it('returns the type of the source node output port referenced by the connection', () => {
    const inputManifest: NodeManifest = {
      id: 'pytorch_models.input',
      category: 'Models (PyTorch)',
      label: 'Input',
      inputs: [{ name: 'train_table', type: 'Table' }],
      outputs: [{ name: 'architecture', type: 'Layer' }],
      params: [],
      long_running: false,
    }
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: inputManifest, params: {} },
    }

    const result = outputPortTypeForConnection(
      { source: 'n1', sourceHandle: 'architecture', target: 'n2', targetHandle: 'architecture' },
      [node],
    )

    expect(result).toBe('Layer')
  })

  it('returns undefined when the source node or port is not found', () => {
    const result = outputPortTypeForConnection(
      { source: 'missing', sourceHandle: 'x', target: 'n2', targetHandle: 'y' },
      [],
    )

    expect(result).toBeUndefined()
  })
})

describe('PipelineCanvas port/edge coloring', () => {
  it('colors a port handle by its port type', () => {
    const inputManifest: NodeManifest = {
      id: 'pytorch_models.input',
      category: 'Models (PyTorch)',
      label: 'Input',
      inputs: [{ name: 'train_table', type: 'Table' }],
      outputs: [{ name: 'architecture', type: 'Layer' }],
      params: [],
      long_running: false,
    }
    vi.mocked(client.useNodes).mockReturnValue({
      data: [inputManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: inputManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    expect(handles).toHaveLength(2)
    expect(handles[0]?.style.background).toBe('rgb(74, 144, 217)') // Table (target: train_table)
    expect(handles[1]?.style.background).toBe('rgb(155, 89, 182)') // Layer (source: architecture)
  })

  it('colors an edge by the source port type stashed in edge.data', async () => {
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
    const edge: PipelineEdge = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'table',
      targetHandle: 'table',
      data: { portType: 'Table' },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[nodeA, nodeB]}
        edges={[edge]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    await screen.findByRole('button', { name: /delete connection/i })

    const edgePath = container.querySelector<SVGPathElement>('.react-flow__edge-path')
    expect(edgePath?.style.stroke).toBe('rgb(74, 144, 217)')
  })
})

describe('PipelineCanvas ImageBatch port coloring', () => {
  it('colors an ImageBatch port handle distinctly from Table/Layer', () => {
    const loaderManifest: NodeManifest = {
      id: 'data.built_in_image_dataset',
      category: 'Data',
      label: 'Built-in Image Dataset',
      inputs: [],
      outputs: [
        { name: 'train', type: 'ImageBatch' },
        { name: 'test', type: 'ImageBatch' },
      ],
      params: [],
      long_running: false,
    }
    vi.mocked(client.useNodes).mockReturnValue({
      data: [loaderManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: loaderManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    expect(handles).toHaveLength(2)
    expect(handles[0]?.style.background).toBe('rgb(231, 76, 60)')
    expect(handles[0]?.style.background).not.toBe('rgb(74, 144, 217)') // not Table
    expect(handles[0]?.style.background).not.toBe('rgb(155, 89, 182)') // not Layer
  })
})

describe('PipelineCanvas node status', () => {
  it('applies a status class to a node based on the nodeStatuses map', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
        nodeStatuses={{ n1: 'running' }}
      />,
    )

    expect(container.querySelector('.pipeline-node-running')).not.toBeNull()
  })

  it('defaults an unlisted node to the idle status class', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    expect(container.querySelector('.pipeline-node-idle')).not.toBeNull()
  })

  it('marks an edge animated when its target node is running', async () => {
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

    const { container } = render(
      <PipelineCanvas
        nodes={[nodeA, nodeB]}
        edges={[edge]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
        nodeStatuses={{ n2: 'running' }}
      />,
    )

    await screen.findByRole('button', { name: /delete connection/i })

    expect(container.querySelector('.react-flow__edge.animated')).not.toBeNull()
  })
})
