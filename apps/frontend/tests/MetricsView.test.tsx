import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsView } from '../src/metrics/MetricsView'

describe('MetricsView', () => {
  it('renders scalar metrics as formatted stat rows', () => {
    render(<MetricsView metrics={{ accuracy: 0.913456, final_val_loss: 0.2 }} />)

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9135')).toBeInTheDocument()
    expect(screen.getByText('Final Val Loss')).toBeInTheDocument()
    expect(screen.getByText('0.2000')).toBeInTheDocument()
  })

  it('renders a confusion matrix as a labeled grid with the diagonal highlighted', () => {
    render(
      <MetricsView
        metrics={{
          confusion_matrix: [
            [8, 3],
            [2, 9],
          ],
          labels: [0, 1],
        }}
      />,
    )

    const table = screen.getByRole('table')
    const diagonalCells = table.querySelectorAll('.confusion-matrix-diagonal')
    expect(diagonalCells).toHaveLength(2)
    expect(diagonalCells[0]).toHaveTextContent('8')
    expect(diagonalCells[1]).toHaveTextContent('9')
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getAllByText('1')).toHaveLength(2)
  })

  it('renders an ROC curve as an SVG line chart alongside the AUC score', () => {
    render(
      <MetricsView
        metrics={{
          roc_auc: 0.9231,
          fpr: [0, 0.2, 1],
          tpr: [0, 0.8, 1],
        }}
      />,
    )

    expect(screen.getByText('Roc Auc')).toBeInTheDocument()
    expect(screen.getByText('0.9231')).toBeInTheDocument()

    const svg = screen.getByRole('img', { name: 'ROC curve' })
    const polyline = svg.querySelector('polyline')
    expect(polyline).not.toBeNull()
    expect(polyline?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(3)
  })

  it('falls back to a formatted block for an unrecognized metrics shape', () => {
    render(<MetricsView metrics={{ weird: { nested: true } }} />)

    expect(screen.getByText(/"weird"/)).toBeInTheDocument()
  })
})
