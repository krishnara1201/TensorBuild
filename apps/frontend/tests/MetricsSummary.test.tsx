import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsSummary } from '../src/metrics/MetricsSummary'

describe('MetricsSummary', () => {
  it('renders scalar metrics as formatted stat rows', () => {
    render(<MetricsSummary metrics={{ accuracy: 0.913456, final_val_loss: 0.2 }} />)

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9135')).toBeInTheDocument()
    expect(screen.getByText('Final Val Loss')).toBeInTheDocument()
    expect(screen.getByText('0.2000')).toBeInTheDocument()
  })

  it('ignores confusion-matrix and ROC keys, rendering only the remaining scalars', () => {
    render(
      <MetricsSummary
        metrics={{
          accuracy: 0.9,
          confusion_matrix: [
            [8, 3],
            [2, 9],
          ],
          labels: [0, 1],
        }}
      />,
    )

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('falls back to a formatted block for an unrecognized metrics shape', () => {
    render(<MetricsSummary metrics={{ weird: { nested: true } }} />)

    expect(screen.getByText(/"weird"/)).toBeInTheDocument()
  })

  it('renders nothing when only chart keys are present', () => {
    const { container } = render(<MetricsSummary metrics={{ fpr: [0, 1], tpr: [0, 1] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
