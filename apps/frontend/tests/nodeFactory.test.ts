import { describe, expect, it } from 'vitest'
import { createPipelineNode, defaultsFromManifest, nextNodeId } from '../src/canvas/nodeFactory'
import type { NodeManifest } from '../src/api/types'
import type { PipelineNode } from '../src/canvas/types'

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

describe('defaultsFromManifest', () => {
  it("builds a params object from each param spec's default", () => {
    expect(defaultsFromManifest(splitManifest)).toEqual({ test_size: 0.2, random_state: 42 })
  })

  it('returns an empty object for a manifest with no params', () => {
    expect(defaultsFromManifest({ ...splitManifest, params: [] })).toEqual({})
  })
})

describe('createPipelineNode', () => {
  it('builds a React Flow node with the given id, position, and default params', () => {
    const result = createPipelineNode(splitManifest, 'n2', { x: 100, y: 50 })

    expect(result).toEqual({
      id: 'n2',
      type: 'pipelineNode',
      position: { x: 100, y: 50 },
      data: {
        manifest: splitManifest,
        params: { test_size: 0.2, random_state: 42 },
      },
    })
  })
})

describe('nextNodeId', () => {
  it('returns n1 for an empty canvas', () => {
    expect(nextNodeId([])).toBe('n1')
  })

  it('returns one past the highest existing numeric suffix', () => {
    const nodes: PipelineNode[] = [
      { id: 'n1', type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: splitManifest, params: {} } },
      { id: 'n3', type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: splitManifest, params: {} } },
    ]

    expect(nextNodeId(nodes)).toBe('n4')
  })

  it('ignores node ids that do not match the n<number> pattern (e.g. loaded from a hand-edited file)', () => {
    const nodes: PipelineNode[] = [
      {
        id: 'custom_node',
        type: 'pipelineNode',
        position: { x: 0, y: 0 },
        data: { manifest: splitManifest, params: {} },
      },
    ]

    expect(nextNodeId(nodes)).toBe('n1')
  })
})
