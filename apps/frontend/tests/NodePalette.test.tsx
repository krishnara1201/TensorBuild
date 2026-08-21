import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { groupByCategory, NodePalette } from '../src/palette/NodePalette'
import * as client from '../src/api/client'
import type { NodeManifest } from '../src/api/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn() }
})

const manifests: NodeManifest[] = [
  { id: 'data.csv_loader', category: 'Data', label: 'CSV Loader', inputs: [], outputs: [], params: [], long_running: false },
  { id: 'data.train_test_split', category: 'Data', label: 'Train/Test Split', inputs: [], outputs: [], params: [], long_running: false },
  { id: 'sklearn_models.random_forest', category: 'Models (sklearn)', label: 'Random Forest', inputs: [], outputs: [], params: [], long_running: false },
]

describe('groupByCategory', () => {
  it('groups manifests by category, preserving order within a category', () => {
    const groups = groupByCategory(manifests)

    expect(Array.from(groups.keys())).toEqual(['Data', 'Models (sklearn)'])
    expect(groups.get('Data')?.map((m) => m.id)).toEqual(['data.csv_loader', 'data.train_test_split'])
  })
})

describe('NodePalette', () => {
  it('renders category headings and node labels once loaded', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: manifests,
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)

    render(<NodePalette />)

    expect(screen.getByText('Data')).toBeInTheDocument()
    expect(screen.getByText('CSV Loader')).toBeInTheDocument()
    expect(screen.getByText('Models (sklearn)')).toBeInTheDocument()
    expect(screen.getByText('Random Forest')).toBeInTheDocument()
  })

  it('shows an engine-unreachable banner when the query errors', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network error'),
    } as ReturnType<typeof client.useNodes>)

    render(<NodePalette />)

    expect(screen.getByText(/can't reach engine/i)).toBeInTheDocument()
  })
})
