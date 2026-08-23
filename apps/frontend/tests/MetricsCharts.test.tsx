import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsCharts } from '../src/visualizations/MetricsCharts'

describe('MetricsCharts', () => {
  it('renders a confusion matrix as a labeled grid with the diagonal highlighted', () => {
    render(
      <MetricsCharts
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
  })

  it('renders an ROC curve chart when fpr/tpr are present', () => {
    const { container } = render(<MetricsCharts metrics={{ roc_auc: 0.9231, fpr: [0, 0.2, 1], tpr: [0, 0.8, 1] }} />)

    expect(container.querySelector('.roc-curve-chart')).not.toBeNull()
  })

  it('renders both sections when a confusion matrix and an ROC curve are both present', () => {
    const { container } = render(
      <MetricsCharts
        metrics={{
          confusion_matrix: [[1, 0], [0, 1]],
          labels: [0, 1],
          fpr: [0, 1],
          tpr: [0, 1],
        }}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelector('.roc-curve-chart')).not.toBeNull()
  })

  it('renders nothing when neither chart shape is present', () => {
    const { container } = render(<MetricsCharts metrics={{ accuracy: 0.9 }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
