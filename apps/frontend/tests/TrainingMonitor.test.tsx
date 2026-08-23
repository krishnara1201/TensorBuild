import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrainingMonitor } from '../src/training/TrainingMonitor'
import * as trainingRun from '../src/training/useTrainingRun'
import type { TrainingState } from '../src/training/useTrainingRun'

vi.mock('../src/training/useTrainingRun', async () => {
  const actual = await vi.importActual<typeof import('../src/training/useTrainingRun')>(
    '../src/training/useTrainingRun',
  )
  return { ...actual, useTrainingRun: vi.fn() }
})

function mockState(state: TrainingState) {
  vi.mocked(trainingRun.useTrainingRun).mockReturnValue(state)
}

describe('TrainingMonitor', () => {
  it('shows a "Training…" heading while a run is in progress', () => {
    mockState({
      status: 'running',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
    })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training…')).toBeInTheDocument()
  })

  it('shows final metrics when training completes', () => {
    mockState({
      status: 'complete',
      history: [],
      metrics: { 'n6.metrics': { accuracy: 0.9 } },
    })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training complete')).toBeInTheDocument()
    expect(screen.getByText(/n6\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9000')).toBeInTheDocument()
  })

  it('shows the error banner when training fails', () => {
    mockState({ status: 'error', history: [], error: 'CUDA out of memory' })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training failed')).toBeInTheDocument()
    expect(screen.getByText('CUDA out of memory')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    mockState({ status: 'connecting', history: [] })
    const onClose = vi.fn()

    render(<TrainingMonitor runId="run-1" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
