import { describe, expect, it } from 'vitest'
import { toIR, fromVmbFile, toVmbFile } from '../src/ir/convert'
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

describe('toVmbFile', () => {
  it('wraps toIR output with version and per-node layout positions', () => {
    const nodes = [{ ...node('n1', csvManifest, { path: 'iris.csv' }), position: { x: 10, y: 20 } }]

    const file = toVmbFile(nodes, [])

    expect(file).toEqual({
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: { path: 'iris.csv' } }], edges: [] },
      layout: { n1: { x: 10, y: 20 } },
    })
  })
})

describe('fromVmbFile', () => {
  const manifests = [csvManifest, splitManifest]

  it('round-trips a file produced by toVmbFile back to equivalent nodes/edges', () => {
    const nodes = [
      { ...node('n1', csvManifest, { path: 'iris.csv' }), position: { x: 10, y: 20 } },
      { ...node('n2', splitManifest, { test_size: 0.2, random_state: 42 }), position: { x: 200, y: 20 } },
    ]
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ]

    const file = toVmbFile(nodes, edges)
    const result = fromVmbFile(file, manifests)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes).toEqual([
      {
        id: 'n1',
        type: 'pipelineNode',
        position: { x: 10, y: 20 },
        data: { manifest: csvManifest, params: { path: 'iris.csv' } },
      },
      {
        id: 'n2',
        type: 'pipelineNode',
        position: { x: 200, y: 20 },
        data: { manifest: splitManifest, params: { test_size: 0.2, random_state: 42 } },
      },
    ])
    expect(result.edges).toEqual([
      { id: 'n1:table->n2:table', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ])
  })

  it('fails with a clear error when the file references an unknown node type', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'pytorch_models.gru', params: {} }], edges: [] },
      layout: { n1: { x: 0, y: 0 } },
    }

    expect(fromVmbFile(file, manifests)).toEqual({ ok: false, error: 'Unknown node types: pytorch_models.gru' })
  })

  it('lists every unknown node type, not just the first', () => {
    const file = {
      version: 1,
      ir: {
        nodes: [
          { id: 'n1', type: 'pytorch_models.gru', params: {} },
          { id: 'n2', type: 'evaluation.f1_score', params: {} },
        ],
        edges: [],
      },
      layout: {},
    }

    expect(fromVmbFile(file, manifests)).toEqual({
      ok: false,
      error: 'Unknown node types: pytorch_models.gru, evaluation.f1_score',
    })
  })

  it('fails with a clear error on an unsupported version', () => {
    const file = { version: 99, ir: { nodes: [], edges: [] }, layout: {} }

    expect(fromVmbFile(file, manifests)).toEqual({
      ok: false,
      error: 'Unsupported project file version 99 (this build supports version 1).',
    })
  })

  it('fails with a clear error when the file is not a JSON object', () => {
    const expected = { ok: false, error: 'This file is not a valid TensorBuild project (not a JSON object).' }
    expect(fromVmbFile('not an object', manifests)).toEqual(expected)
    expect(fromVmbFile(null, manifests)).toEqual(expected)
    expect(fromVmbFile([1, 2, 3], manifests)).toEqual(expected)
  })

  it('fails with a clear error when pipeline data is missing', () => {
    expect(fromVmbFile({ version: 1 }, manifests)).toEqual({
      ok: false,
      error: 'This file is not a valid TensorBuild project (missing pipeline data).',
    })
  })

  it('defaults a node with no layout entry to {x: 0, y: 0} rather than failing', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
      layout: {},
    }

    const result = fromVmbFile(file, manifests)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('fails with a clear error when a node entry is null instead of throwing', () => {
    const file = {
      version: 1,
      ir: { nodes: [null], edges: [] },
      layout: {},
    }

    const result = fromVmbFile(file, manifests)

    expect(result).toEqual({
      ok: false,
      error: 'This file is not a valid TensorBuild project (missing pipeline data).',
    })
  })

  it('fails with a clear error when a node is missing type field', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', params: {} }], edges: [] },
      layout: {},
    }

    const result = fromVmbFile(file, manifests)

    expect(result).toEqual({
      ok: false,
      error: 'This file is not a valid TensorBuild project (missing pipeline data).',
    })
  })

  it('fails with a clear error when an edge is missing from field', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [{ to: 'n2.table' }] },
      layout: {},
    }

    const result = fromVmbFile(file, manifests)

    expect(result).toEqual({
      ok: false,
      error: 'This file is not a valid TensorBuild project (missing pipeline data).',
    })
  })
})
