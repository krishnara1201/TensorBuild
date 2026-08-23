import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PreviewPanel } from '../src/preview/PreviewPanel'
import type { PreviewState } from '../src/preview/usePreview'

describe('PreviewPanel', () => {
  it('shows a prompt to select a node when idle', () => {
    render(<PreviewPanel state={{ status: 'idle' }} />)
    expect(screen.getByText('Select "Preview Output" on a node to see its data here.')).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    render(<PreviewPanel state={{ status: 'loading' }} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    render(<PreviewPanel state={{ status: 'error', error: 'bad path' }} />)
    expect(screen.getByText('bad path')).toBeInTheDocument()
  })

  it('renders columns, rows, and a row-count footer on success', () => {
    const state: PreviewState = {
      status: 'success',
      data: {
        columns: [
          { name: 'age', dtype: 'int64' },
          { name: 'label', dtype: 'object' },
        ],
        rows: [
          [25, 'yes'],
          [31, 'no'],
        ],
        total_rows: 4200,
      },
    }
    render(<PreviewPanel state={state} />)

    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getByText('int64')).toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 4,200 rows')).toBeInTheDocument()
  })
})
