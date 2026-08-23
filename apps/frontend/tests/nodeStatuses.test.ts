import { describe, expect, it } from 'vitest'
import { nodeStatusesFromTrainingState } from '../src/training/nodeStatuses'

describe('nodeStatusesFromTrainingState', () => {
  it('marks every node that has emitted progress as running', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'running',
      history: [
        { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 },
        { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.4, val_loss: 0.5 },
        { event: 'progress', node_id: 'n7', epoch: 1, loss: 0.3, val_loss: 0.4 },
      ],
    })

    expect(result).toEqual({ n5: 'running', n7: 'running' })
  })

  it('marks every node that reported progress as success once the run completes', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'complete',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      metrics: {},
    })

    expect(result).toEqual({ n5: 'success' })
  })

  it('marks the failing node as error when a node_error carried a nodeId', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'error',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      error: 'CUDA out of memory',
      nodeId: 'n5',
    })

    expect(result).toEqual({ n5: 'error' })
  })

  it('returns an empty map for a connecting state with no history', () => {
    expect(nodeStatusesFromTrainingState({ status: 'connecting', history: [] })).toEqual({})
  })

  it('does not mark any node as error when the error has no nodeId (e.g. connection lost)', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'error',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      error: 'connection lost',
    })

    expect(result).toEqual({ n5: 'running' })
  })
})
