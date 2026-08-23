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

  it('renders run metrics on the Results tab', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n4.metrics': { accuracy: 0.95 } }}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
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
