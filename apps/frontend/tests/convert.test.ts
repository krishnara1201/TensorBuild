import { describe, expect, it } from 'vitest'
import { toIR } from '../src/ir/convert'
import type { PipelineEdge, PipelineNode } from '../src/canvas/types'
import type { NodeManifest } from '../src/api/types'

const csvManifest: NodeManifest = {
  id: 'data.csv_loader',
  category: 'Data',
  label: 'CSV Loader',
  inputs: [],
  outputs: [{ name: 'table', type: 'Table' }],
  params: [{ name: 'path', type: 'text', label: 'File Path', default: '' }],
  long_running: false,
}

const splitManifest: NodeManifest = {
  id: 'data.train_test_split',
  category: 'Data',
  label: 'Train/Test Split',
  inputs: [{ name: 'table', type: 'Table' }],
  outputs: [
    { name: 'train', type: 'Table' },
    { name: 'test', type: 'Table' },
  ],
  params: [
    { name: 'test_size', type: 'number', label: 'Test Size', default: 0.2 },
    { name: 'random_state', type: 'number', label: 'Random State', default: 42 },
  ],
  long_running: false,
}

function node(id: string, manifest: NodeManifest, params: Record<string, unknown>): PipelineNode {
  return { id, type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest, params } }
}

describe('toIR', () => {
  it('converts nodes to NodeSpec, dropping position and UI state', () => {
    const nodes = [node('n1', csvManifest, { path: 'iris.csv' })]

    const ir = toIR(nodes, [])

    expect(ir.nodes).toEqual([{ id: 'n1', type: 'data.csv_loader', params: { path: 'iris.csv' } }])
  })

  it('converts edges to "node.port" from/to strings', () => {
    const nodes = [
      node('n1', csvManifest, { path: 'iris.csv' }),
      node('n2', splitManifest, { test_size: 0.2, random_state: 42 }),
    ]
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ]

    const ir = toIR(nodes, edges)

    expect(ir.edges).toEqual([{ from: 'n1.table', to: 'n2.table' }])
  })

  it('throws if an edge is missing a source or target handle', () => {
    const nodes = [node('n1', csvManifest, {})]
    const edges = [{ id: 'e1', source: 'n1', target: 'n2' } as PipelineEdge]

    expect(() => toIR(nodes, edges)).toThrow(/missing a source or target handle/)
  })

  it('round-trips param values unchanged, including non-default overrides', () => {
    const nodes = [node('n2', splitManifest, { test_size: 0.3, random_state: 7 })]

    const ir = toIR(nodes, [])

    expect(ir.nodes[0].params).toEqual({ test_size: 0.3, random_state: 7 })
  })
})
