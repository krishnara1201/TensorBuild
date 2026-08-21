import { describe, expect, it } from 'vitest'
import { isValidConnection } from '../src/canvas/validation'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest, Port } from '../src/api/types'

function manifest(id: string, outputs: Port[], inputs: Port[]): NodeManifest {
  return { id, category: 'Test', label: id, inputs, outputs, params: [], long_running: false }
}

function node(id: string, m: NodeManifest): PipelineNode {
  return { id, type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: m, params: {} } }
}

describe('isValidConnection', () => {
  const tableOut = manifest('data.csv_loader', [{ name: 'table', type: 'Table' }], [])
  const tableIn = manifest('data.train_test_split', [], [{ name: 'table', type: 'Table' }])
  const modelIn = manifest('evaluation.evaluate_classifier', [], [{ name: 'model', type: 'Model' }])

  it('accepts a connection between matching port types', () => {
    const nodes = [node('n1', tableOut), node('n2', tableIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(true)
  })

  it('rejects a connection between mismatched port types', () => {
    const nodes = [node('n1', tableOut), node('n3', modelIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n3', targetHandle: 'model' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a self-loop', () => {
    const nodes = [node('n1', tableOut)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n1', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a connection missing a handle', () => {
    const nodes = [node('n1', tableOut), node('n2', tableIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: null, target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a connection referencing an unknown node', () => {
    const nodes = [node('n1', tableOut)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })
})
