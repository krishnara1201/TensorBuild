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

  it('falls back to a formatted block for an unrecognized metrics shape', () => {
    render(<MetricsView metrics={{ weird: { nested: true } }} />)

    expect(screen.getByText(/"weird"/)).toBeInTheDocument()
  })
})
