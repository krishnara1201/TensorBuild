import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutputPanel } from '../src/output/OutputPanel'

describe('OutputPanel', () => {
  it('shows the empty-results message on the Results tab when there is no run data yet', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('Run the pipeline to see results here.')).toBeInTheDocument()
  })

  it('shows the empty-results message (not a blank metrics list) when runMetrics is a truthy empty object', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{}}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('Run the pipeline to see results here.')).toBeInTheDocument()
  })

  it('renders run metrics on the Results tab, labeled by node id when no manifest label is known', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n4.metrics': { accuracy: 0.95 } }}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('n4')).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
  })

  it('labels the metrics block with the node manifest label when nodeLabels is provided', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n4.metrics': { accuracy: 0.95 } }}
        runError={null}
        previewState={{ status: 'idle' }}
        nodeLabels={{ n4: 'Evaluate Classifier' }}
      />,
    )

    expect(screen.getByText('Evaluate Classifier')).toBeInTheDocument()
    expect(screen.queryByText('n4')).not.toBeInTheDocument()
  })

  it('shows a node dropdown and switches the displayed metrics block when there are multiple', async () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n2.metrics': { accuracy: 0.95 }, 'n5.metrics': { r2: 0.8 } }}
        runError={null}
        previewState={{ status: 'idle' }}
        nodeLabels={{ n2: 'Evaluate Classifier', n5: 'Evaluate Regressor' }}
      />,
    )

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.queryByText('R2')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'Evaluate Regressor')

    expect(screen.getByText('R2')).toBeInTheDocument()
    expect(screen.queryByText('Accuracy')).not.toBeInTheDocument()
  })

  it('does not show a node dropdown when there is only one metrics block', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n4.metrics': { accuracy: 0.95 } }}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('renders the run error on the Results tab', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError="unknown node type"
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('unknown node type')).toBeInTheDocument()
  })

  it('renders the preview panel on the Data Preview tab', () => {
    render(
      <OutputPanel
        activeTab="preview"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'loading' }}
      />,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('calls onTabChange when a tab button is clicked', async () => {
    const onTabChange = vi.fn()
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={onTabChange}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Data Preview' }))

    expect(onTabChange).toHaveBeenCalledWith('preview')
  })
})
