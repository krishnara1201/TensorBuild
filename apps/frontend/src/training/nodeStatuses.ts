import type { NodeRunStatus } from '../canvas/types'
import type { TrainingState } from './useTrainingRun'

export function nodeStatusesFromTrainingState(state: TrainingState): Record<string, NodeRunStatus> {
  const statuses: Record<string, NodeRunStatus> = {}

  for (const event of state.history) {
    statuses[event.node_id] = 'running'
  }

  if (state.status === 'complete') {
    for (const nodeId of Object.keys(statuses)) {
      statuses[nodeId] = 'success'
    }
  }

  if (state.status === 'error' && state.nodeId) {
    statuses[state.nodeId] = 'error'
  }

  return statuses
}
