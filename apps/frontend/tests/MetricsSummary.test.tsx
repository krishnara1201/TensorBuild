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

  it('renders a flat coefficient dict as a table, alongside the scalar intercept', () => {
    render(
      <MetricsSummary
        metrics={{ coefficients: { age: 0.5123, income: -1.2 }, intercept: 3.14159 }}
      />,
    )

    expect(screen.getByText('Intercept')).toBeInTheDocument()
    expect(screen.getByText('3.142')).toBeInTheDocument()
    expect(screen.getByText('Coefficients')).toBeInTheDocument()
    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getByText('0.5123')).toBeInTheDocument()
    expect(screen.getByText('income')).toBeInTheDocument()
    expect(screen.getByText('-1.200')).toBeInTheDocument()
  })

  it('renders a per-class coefficient dict-of-dicts as a matrix table', () => {
    render(
      <MetricsSummary
        metrics={{
          coefficients: {
            setosa: { petal_length: 0.1, petal_width: 0.2 },
            virginica: { petal_length: 0.3, petal_width: 0.4 },
          },
        }}
      />,
    )

    expect(screen.getByText('setosa')).toBeInTheDocument()
    expect(screen.getByText('virginica')).toBeInTheDocument()
    expect(screen.getByText('petal_length')).toBeInTheDocument()
    expect(screen.getByText('petal_width')).toBeInTheDocument()
  })

  it('renders a list of dicts (e.g. cluster centers) as a table', () => {
    render(
      <MetricsSummary
        metrics={{ cluster_centers: [{ x: 1.5, y: 2.5 }, { x: 3.5, y: 4.5 }], inertia: 12.34 }}
      />,
    )

    expect(screen.getByText('Cluster Centers')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
    expect(screen.getByText('Inertia')).toBeInTheDocument()
  })

  it('renders a flat list of scalars (e.g. n_support) as a comma-separated line', () => {
    render(<MetricsSummary metrics={{ kernel: 'rbf', n_support: [12, 34] }} />)

    expect(screen.getByText('Kernel')).toBeInTheDocument()
    expect(screen.getByText('rbf')).toBeInTheDocument()
    expect(screen.getByText('12, 34')).toBeInTheDocument()
  })
})
