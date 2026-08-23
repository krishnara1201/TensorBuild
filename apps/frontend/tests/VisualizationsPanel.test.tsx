import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VisualizationsPanel } from '../src/visualizations/VisualizationsPanel'

describe('VisualizationsPanel', () => {
  it('shows an empty-state message when there is nothing to chart', () => {
    render(<VisualizationsPanel runMetrics={undefined} previewData={undefined} trainingState={undefined} />)
    expect(screen.getByText('Run the pipeline or preview data to see charts here.')).toBeInTheDocument()
  })

  it('renders a metrics chart section when run metrics contain a confusion matrix', () => {
    render(
      <VisualizationsPanel
        runMetrics={{
          'n4.metrics': {
            confusion_matrix: [
              [1, 0],
              [0, 1],
            ],
            labels: [0, 1],
          },
        }}
        previewData={undefined}
        trainingState={undefined}
        nodeLabels={{ n4: 'Confusion Matrix' }}
      />,
    )
    expect(screen.getByText('Confusion Matrix')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('skips a metrics entry that has no chartable shape', () => {
    render(
      <VisualizationsPanel
        runMetrics={{ 'n4.metrics': { accuracy: 0.9 } }}
        previewData={undefined}
        trainingState={undefined}
      />,
    )
    expect(screen.queryByText('n4')).not.toBeInTheDocument()
  })

  it('shows a node dropdown and switches the displayed chart section when multiple nodes are chartable', async () => {
    render(
      <VisualizationsPanel
        runMetrics={{
          'n2.metrics': {
            confusion_matrix: [
              [1, 0],
              [0, 1],
            ],
            labels: [0, 1],
          },
          'n5.metrics': { fpr: [0, 1], tpr: [0, 1] },
        }}
        previewData={undefined}
        trainingState={undefined}
        nodeLabels={{ n2: 'Confusion Matrix', n5: 'ROC AUC' }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Confusion Matrix' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'ROC AUC')

    expect(screen.getByRole('heading', { name: 'ROC AUC' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders a histogram section per numeric column when preview data is present', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={{
          columns: [
            { name: 'age', dtype: 'int64' },
            { name: 'label', dtype: 'object' },
          ],
          rows: [
            [20, 'a'],
            [30, 'b'],
            [40, 'a'],
          ],
          total_rows: 3,
        }}
        trainingState={undefined}
      />,
    )
    expect(screen.getByText('age distribution')).toBeInTheDocument()
    expect(screen.queryByText('label distribution')).not.toBeInTheDocument()
  })

  it('shows a column dropdown and switches the displayed histogram when there are multiple numeric columns', async () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={{
          columns: [
            { name: 'age', dtype: 'int64' },
            { name: 'income', dtype: 'int64' },
          ],
          rows: [
            [20, 1000],
            [30, 2000],
            [40, 3000],
          ],
          total_rows: 3,
        }}
        trainingState={undefined}
      />,
    )

    expect(screen.getByText('age distribution')).toBeInTheDocument()
    expect(screen.queryByText('income distribution')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'income')

    expect(screen.getByText('income distribution')).toBeInTheDocument()
    expect(screen.queryByText('age distribution')).not.toBeInTheDocument()
  })

  it('does not render a histogram section for a numeric-dtype column with zero numeric values', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={{
          columns: [{ name: 'age', dtype: 'int64' }],
          rows: [[null], [null]],
          total_rows: 2,
        }}
        trainingState={undefined}
      />,
    )
    expect(screen.queryByText('age distribution')).not.toBeInTheDocument()
    expect(screen.getByText('Run the pipeline or preview data to see charts here.')).toBeInTheDocument()
  })

  it('renders a training curve section with a status heading while a run is in progress', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={undefined}
        trainingState={{
          status: 'running',
          history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
        }}
      />,
    )
    expect(screen.getByText('Training…')).toBeInTheDocument()
  })

  it('shows "Training complete" once the run finishes', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={undefined}
        trainingState={{ status: 'complete', history: [], metrics: {} }}
      />,
    )
    expect(screen.getByText('Training complete')).toBeInTheDocument()
  })
})
