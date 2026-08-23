import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App'
import type { NodeManifest } from '../src/api/types'

// Every other App/palette/canvas test mocks `../src/api/client` directly, so
// nothing exercises the real client.ts + useNodes/useRunPipeline hooks
// wired into App against an actual network boundary. This test stubs only
// `fetch` (like client.test.ts does) and does NOT mock src/api/client, so a
// bug in that wiring — e.g. the CORS gap this fix wave addresses — would
// show up here instead of only in a real browser.
const manifests: NodeManifest[] = [
  {
    id: 'data.csv_loader',
    category: 'Data',
    label: 'CSV Loader',
    inputs: [],
    outputs: [{ name: 'table', type: 'Table' }],
    params: [],
    long_running: false,
  },
  {
    id: 'data.train_test_split',
    category: 'Data',
    label: 'Train/Test Split',
    inputs: [{ name: 'table', type: 'Table' }],
    outputs: [
      { name: 'train', type: 'Table' },
      { name: 'test', type: 'Table' },
    ],
    params: [],
    long_running: false,
  },
]

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe('App integration (real client.ts + hooks, fetch stubbed at the network boundary)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/nodes')) {
          return Promise.resolve({ ok: true, json: async () => manifests } as Response)
        }
        if (url.endsWith('/pipeline/run')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ metrics: {} }) } as Response)
        }
        return Promise.reject(new Error(`unexpected fetch to ${url}`))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('populates the palette from a real GET /nodes and POSTs the pipeline IR on Run', async () => {
    renderApp()

    // Proves the real useNodes() -> getNodes() -> fetch chain runs end to
    // end and the palette renders what it returns.
    expect(await screen.findByText('CSV Loader')).toBeInTheDocument()
    expect(screen.getByText('Train/Test Split')).toBeInTheDocument()

    const runButton = screen.getByRole('button', { name: /^run$/i })
    expect(runButton).not.toBeDisabled()

    await userEvent.click(runButton)

    // Proves the real useRunPipeline() -> runPipeline() -> fetch chain
    // fires with the exact request the engine expects, not a mocked
    // `mutate` call.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [], edges: [] }),
      })
    })
  })
})

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }
}

describe('App integration — async training run (real client.ts + hooks, WS stubbed)', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/nodes')) {
          return Promise.resolve({ ok: true, json: async () => manifests } as Response)
        }
        if (url.endsWith('/pipeline/run')) {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({ run_id: 'run-123' }),
          } as Response)
        }
        return Promise.reject(new Error(`unexpected fetch to ${url}`))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a WebSocket to /ws/runs/{run_id} and shows training status in the visualizations panel when the engine returns 202', async () => {
    renderApp()

    await screen.findByText('CSV Loader')
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    await waitFor(() => {
      expect(screen.getByText('Training…')).toBeInTheDocument()
    })
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:8000/ws/runs/run-123')
  })
})
