import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDynamicOptions } from '../src/inspector/useDynamicOptions'
import * as client from '../src/api/client'
import type { NodeManifest, ParamSpec } from '../src/api/types'
import type { PipelineEdge, PipelineNode } from '../src/canvas/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, previewSubgraph: vi.fn() }
})

function manifestWithTargetColumn(): NodeManifest {
  const targetColumnParam: ParamSpec = {
    name: 'target_column',
    type: 'select',
    label: 'Target Column',
    default: '',
    options_source: { input_port: 'train_table' },
  }
  return {
    id: 'sklearn_models.logistic_regression',
    category: 'Models (sklearn)',
    label: 'Logistic Regression',
    inputs: [{ name: 'train_table', type: 'Table' }],
    outputs: [{ name: 'model', type: 'Model' }],
    params: [targetColumnParam],
    long_running: false,
  }
}

function csvLoaderManifest(): NodeManifest {
  return {
    id: 'data.csv_loader',
    category: 'Data',
    label: 'CSV Loader',
    inputs: [],
    outputs: [{ name: 'table', type: 'Table' }],
    params: [],
    long_running: false,
  }
}

const selectedNode: PipelineNode = {
  id: 'n2',
  type: 'pipelineNode',
  position: { x: 0, y: 0 },
  data: { manifest: manifestWithTargetColumn(), params: { target_column: '' } },
}

const upstreamNode: PipelineNode = {
  id: 'n1',
  type: 'pipelineNode',
  position: { x: 0, y: 0 },
  data: { manifest: csvLoaderManifest(), params: {} },
}

describe('useDynamicOptions', () => {
  it('reports disconnected when the input port has no incoming edge', () => {
    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], []))

    expect(result.current.target_column).toEqual({ status: 'disconnected' })
  })

  it('loads and reports ready options when connected', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({
      columns: [
        { name: 'age', dtype: 'int64' },
        { name: 'label', dtype: 'int64' },
      ],
      rows: [],
      total_rows: 0,
    })
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'train_table' },
    ]

    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], edges))

    expect(result.current.target_column).toEqual({ status: 'loading' })

    await waitFor(() => {
      expect(result.current.target_column).toEqual({ status: 'ready', options: ['age', 'label'] })
    })
  })

  it('reports error when the preview call fails', async () => {
    vi.mocked(client.previewSubgraph).mockRejectedValueOnce(new Error('bad path'))
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'train_table' },
    ]

    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], edges))

    await waitFor(() => {
      expect(result.current.target_column).toEqual({ status: 'error', message: 'bad path' })
    })
  })

  it('returns an empty record when the selected node has no dynamic-select params', () => {
    const { result } = renderHook(() => useDynamicOptions(upstreamNode, [selectedNode, upstreamNode], []))

    expect(result.current).toEqual({})
  })
})
