# Frontend NN Training Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend consume the already-merged PyTorch NN training
engine work: handle the async `202 {run_id}` response from
`POST /pipeline/run`, stream live training progress over
`WS /ws/runs/{run_id}` into a training-monitor modal with a live loss/
val_loss chart, and give the `Layer` port type its own edge/handle color.

**Architecture:** `api/client.ts`'s `runPipeline` returns a discriminated
`RunOutcome` (`{kind: 'sync', metrics}` vs `{kind: 'async', runId}`) instead
of assuming every response is synchronous. A new `training/useTrainingRun`
hook owns the WebSocket connection and reduces its events into a
`TrainingState`; `training/TrainingMonitor` renders that state as a
full-screen modal (Recharts line chart mid-run, final metrics on
completion, error banner on failure), wired into `App.tsx` behind a new
`activeRunId` piece of state. All five `pytorch_models` node types already
render on the canvas/palette/inspector today with zero code changes (fully
manifest-driven) — no task in this plan touches that path except the
port-color addition.

**Tech Stack:** Same as the existing frontend (React 19, Vite, TypeScript,
`@tanstack/react-query`, `@xyflow/react`, Vitest + React Testing Library),
plus a new `recharts` dependency for the training-progress chart.

**Spec:** `docs/superpowers/specs/2026-08-22-frontend-nn-training-design.md`
(parent context: `docs/superpowers/specs/2026-08-21-nn-training-core-design.md`)

## Global Constraints

- All frontend code lives under `apps/frontend/`; all commands in this plan
  run from that directory unless stated otherwise. All paths below are
  relative to the repo root `/home/shreyash/projects/visual_model_builder`.
- The engine base URL comes from `api/client.ts`'s module-level `baseUrl`
  (resolved once via `resolveBaseUrl()` before `App` mounts, defaulting to
  `http://127.0.0.1:8000`) — do not hardcode a different URL anywhere.
- No WS reconnect/replay logic — a dropped connection before a terminal
  event is a normal `error` state (`"connection lost"`), matching the
  engine's documented no-replay behavior. This is intentional, not a gap to
  fix.
- No run-cancellation UI — no engine endpoint exists for it (explicit
  non-goal in the spec).
- Recharts version: `npm install recharts` and use whatever version npm
  resolves; note the resolved version in your task report if it differs
  from what you expected.
- If a library's actual API shape differs slightly from the code shown in
  a step, the shown code communicates intent — consult the installed
  package's `.d.ts` files under `node_modules` and adapt; re-run the
  step's tests before moving on.
- No E2E/browser automation in this plan. Acceptance is the unit suite
  (Vitest) passing and `npm run build` succeeding (Task 6), plus a
  documented Manual QA pass (end of this document) for a human to run
  afterward against a live browser — no task in this plan claims to have
  performed that pass.

## File Structure

```
apps/frontend/
  package.json                       # + recharts dependency (Task 3)
  src/
    api/
      types.ts                       # RunResult -> RunOutcome (Task 1)
      client.ts                      # runPipeline branches on status; + getRunSocketUrl (Task 1)
    training/
      useTrainingRun.ts               # new: WS hook (Task 2)
      TrainingMonitor.tsx             # new: modal + chart (Task 3)
    App.tsx                          # wires activeRunId + TrainingMonitor (Task 4)
    codeview/
      CodeViewPanel.tsx               # .code-view-panel -> shared .modal-panel classes (Task 3)
    canvas/
      PipelineCanvas.tsx              # port/edge color by type (Task 5)
    index.css                        # .modal-panel rename + chart spacing (Task 3)
  tests/
    client.test.ts                   # extended (Task 1)
    useTrainingRun.test.ts            # new (Task 2)
    TrainingMonitor.test.tsx          # new (Task 3)
    App.test.tsx                     # extended (Task 4)
    App.integration.test.tsx          # extended (Task 4)
    PipelineCanvas.test.tsx           # extended (Task 5)
```

---

### Task 1: Async run outcome (`RunOutcome`, `runPipeline`, `getRunSocketUrl`)

**Files:**
- Modify: `apps/frontend/src/api/types.ts`
- Modify: `apps/frontend/src/api/client.ts`
- Modify: `apps/frontend/tests/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RunOutcome` type (`{kind: 'sync', metrics: Record<string,
  unknown>} | {kind: 'async', runId: string}`) from `api/types.ts`;
  `runPipeline(ir: PipelineIR): Promise<RunOutcome>` and
  `getRunSocketUrl(runId: string): string` from `api/client.ts`. Both are
  used by Task 2 (`getRunSocketUrl`) and Task 4 (`RunOutcome`, via
  `useRunPipeline()`'s now-`RunOutcome`-typed mutation data).

- [ ] **Step 1: Write the failing/updated tests**

Replace `apps/frontend/tests/client.test.ts` with:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCode, getNodes, runPipeline, resolveBaseUrl } from '../src/api/client'
import type { NodeManifest, PipelineIR } from '../src/api/types'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('api/client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getNodes fetches GET /nodes and returns parsed manifests', async () => {
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
    ]
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => manifests,
    } as Response)

    const result = await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/nodes')
    expect(result).toEqual(manifests)
  })

  it('getNodes throws with the status on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)

    await expect(getNodes()).rejects.toThrow('GET /nodes failed: 500')
  })

  it('runPipeline POSTs the IR and returns a sync outcome on 200', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ metrics: { 'n4.metrics': { accuracy: 0.9 } } }),
    } as Response)

    const result = await runPipeline(ir)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ir),
    })
    expect(result).toEqual({ kind: 'sync', metrics: { 'n4.metrics': { accuracy: 0.9 } } })
  })

  it('runPipeline returns an async outcome with the run_id on 202', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ run_id: 'run-abc-123' }),
    } as Response)

    const result = await runPipeline(ir)

    expect(result).toEqual({ kind: 'async', runId: 'run-abc-123' })
  })

  it('runPipeline throws the engine detail message on a 422', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'unknown node type' }),
    } as Response)

    await expect(runPipeline(ir)).rejects.toThrow('unknown node type')
  })

  it('getCode POSTs the IR and returns the generated script', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 'print(1)' }),
    } as Response)

    const result = await getCode(ir)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ir),
    })
    expect(result).toEqual({ code: 'print(1)' })
  })

  it('getRunSocketUrl swaps the http(s) scheme for ws(s)', () => {
    expect(getRunSocketUrl('run-1')).toBe('ws://127.0.0.1:8000/ws/runs/run-1')
  })
})

describe('resolveBaseUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(invoke).mockReset()
  })

  it('uses the Tauri-provided base URL when invoke resolves', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('http://127.0.0.1:54321')

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:54321/nodes')
  })

  it('falls back to the default URL when invoke rejects (no Tauri context)', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no tauri context'))

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/nodes')
  })
})
```

Note: this file adds `getRunSocketUrl` to the existing import and adds/
changes three `it` blocks in the `api/client` describe block (the sync/
async split of the old "returns metrics" test, the new 202 test, and the
new `getRunSocketUrl` test); everything else is unchanged from today.

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

Run: `npm test -- client.test.ts`
Expected: FAIL — `runPipeline` still returns `{metrics}` directly (no
`kind`), and `getRunSocketUrl` doesn't exist yet.

- [ ] **Step 3: Update the types**

In `apps/frontend/src/api/types.ts`, replace the `RunResult` interface with:

```typescript
export type RunOutcome =
  | { kind: 'sync'; metrics: Record<string, unknown> }
  | { kind: 'async'; runId: string }
```

(Leave every other type in this file — `Port`, `ParamSpec`, `NodeManifest`,
`NodeSpec`, `EdgeSpec`, `PipelineIR`, `CodegenResult` — unchanged.)

- [ ] **Step 4: Update the client**

Replace `apps/frontend/src/api/client.ts` with:

```typescript
import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CodegenResult, NodeManifest, PipelineIR, RunOutcome } from './types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'
let baseUrl = DEFAULT_BASE_URL

export async function resolveBaseUrl(): Promise<string> {
  try {
    baseUrl = await invoke<string>('engine_base_url')
  } catch {
    baseUrl = DEFAULT_BASE_URL
  }
  return baseUrl
}

export async function getNodes(): Promise<NodeManifest[]> {
  const response = await fetch(`${baseUrl}/nodes`)
  if (!response.ok) {
    throw new Error(`GET /nodes failed: ${response.status}`)
  }
  return response.json()
}

async function postPipeline(path: string, ir: PipelineIR): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ir),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail =
      body && typeof body.detail === 'string' ? body.detail : `${path} failed: ${response.status}`
    throw new Error(detail)
  }
  return { status: response.status, body: await response.json() }
}

export async function runPipeline(ir: PipelineIR): Promise<RunOutcome> {
  const { status, body } = await postPipeline('/pipeline/run', ir)
  if (status === 202) {
    return { kind: 'async', runId: (body as { run_id: string }).run_id }
  }
  return { kind: 'sync', metrics: (body as { metrics: Record<string, unknown> }).metrics }
}

export async function getCode(ir: PipelineIR): Promise<CodegenResult> {
  const { body } = await postPipeline('/pipeline/codegen', ir)
  return body as CodegenResult
}

export function getRunSocketUrl(runId: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/ws/runs/${runId}`
}

export function useNodes() {
  return useQuery({ queryKey: ['nodes'], queryFn: getNodes })
}

export function useRunPipeline() {
  return useMutation({ mutationFn: runPipeline })
}

export function useGetCode() {
  return useMutation({ mutationFn: getCode })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- client.test.ts`
Expected: PASS (9 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/api apps/frontend/tests/client.test.ts
git commit -m "frontend: branch on 202 in runPipeline, add getRunSocketUrl"
```

---

### Task 2: WebSocket training-progress hook

**Files:**
- Create: `apps/frontend/src/training/useTrainingRun.ts`
- Test: `apps/frontend/tests/useTrainingRun.test.ts`

**Interfaces:**
- Consumes: `getRunSocketUrl(runId: string): string` from
  `api/client.ts` (Task 1).
- Produces: `ProgressEvent` and `TrainingState` types, and
  `useTrainingRun(runId: string | null): TrainingState` — the hook Task 3's
  `TrainingMonitor` renders.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/useTrainingRun.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTrainingRun } from '../src/training/useTrainingRun'

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

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function send(socket: MockWebSocket, data: unknown) {
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(data) })
  })
}

describe('useTrainingRun', () => {
  it('stays connecting with empty history when runId is null', () => {
    const { result } = renderHook(() => useTrainingRun(null))

    expect(result.current).toEqual({ status: 'connecting', history: [] })
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('opens a socket to the run and moves to running on open', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:8000/ws/runs/run-1')

    act(() => {
      MockWebSocket.instances[0]?.onopen?.()
    })

    expect(result.current.status).toBe('running')
  })

  it('accumulates progress events into history', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 })
    send(socket, { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.7, val_loss: 0.8 })

    expect(result.current.status).toBe('running')
    expect(result.current.history).toEqual([
      { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 },
      { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.7, val_loss: 0.8 },
    ])
  })

  it('moves to complete with final metrics on a complete event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 })
    send(socket, { event: 'complete', metrics: { 'n6.metrics': { accuracy: 0.95 } } })

    expect(result.current).toEqual({
      status: 'complete',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.9, val_loss: 1.0 }],
      metrics: { 'n6.metrics': { accuracy: 0.95 } },
    })
  })

  it('moves to error with the message on a node_error event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'node_error', node_id: 'n5', error: 'CUDA out of memory' })

    expect(result.current).toEqual({ status: 'error', history: [], error: 'CUDA out of memory' })
  })

  it('moves to a "connection lost" error state if the socket closes before a terminal event', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    act(() => socket.onclose?.())

    expect(result.current).toEqual({ status: 'error', history: [], error: 'connection lost' })
  })

  it('does not overwrite an already-terminal state when the server closes the socket afterward', () => {
    const { result } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    send(socket, { event: 'complete', metrics: {} })
    act(() => socket.onclose?.())

    expect(result.current).toEqual({ status: 'complete', history: [], metrics: {} })
  })

  it('closes the socket and ignores further events once unmounted', () => {
    const { unmount } = renderHook(() => useTrainingRun('run-1'))
    const socket = MockWebSocket.instances[0]!
    act(() => socket.onopen?.())

    unmount()

    expect(socket.close).toHaveBeenCalledOnce()
    expect(() =>
      send(socket, { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.1, val_loss: 0.1 }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- useTrainingRun.test.ts`
Expected: FAIL — `src/training/useTrainingRun.ts` does not exist yet.

- [ ] **Step 3: Implement the hook**

Create `apps/frontend/src/training/useTrainingRun.ts`:

```typescript
import { useEffect, useState } from 'react'
import { getRunSocketUrl } from '../api/client'

export interface ProgressEvent {
  event: 'progress'
  node_id: string
  epoch: number
  loss: number
  val_loss: number
}

export type TrainingState =
  | { status: 'connecting'; history: ProgressEvent[] }
  | { status: 'running'; history: ProgressEvent[] }
  | { status: 'complete'; history: ProgressEvent[]; metrics: Record<string, unknown> }
  | { status: 'error'; history: ProgressEvent[]; error: string }

type IncomingEvent =
  | ProgressEvent
  | { event: 'complete'; metrics: Record<string, unknown> }
  | { event: 'node_error'; node_id: string; error: string }

function isTerminal(status: TrainingState['status']): boolean {
  return status === 'complete' || status === 'error'
}

export function useTrainingRun(runId: string | null): TrainingState {
  const [state, setState] = useState<TrainingState>({ status: 'connecting', history: [] })

  useEffect(() => {
    setState({ status: 'connecting', history: [] })
    if (!runId) {
      return
    }

    let active = true
    const socket = new WebSocket(getRunSocketUrl(runId))

    socket.onopen = () => {
      if (!active) return
      setState((prev) => (isTerminal(prev.status) ? prev : { status: 'running', history: prev.history }))
    }

    socket.onmessage = (message) => {
      if (!active) return
      const data = JSON.parse(message.data as string) as IncomingEvent
      setState((prev) => {
        if (isTerminal(prev.status)) return prev
        if (data.event === 'progress') {
          return { status: 'running', history: [...prev.history, data] }
        }
        if (data.event === 'complete') {
          return { status: 'complete', history: prev.history, metrics: data.metrics }
        }
        return { status: 'error', history: prev.history, error: data.error }
      })
    }

    const handleDisconnect = () => {
      if (!active) return
      setState((prev) =>
        isTerminal(prev.status) ? prev : { status: 'error', history: prev.history, error: 'connection lost' },
      )
    }
    socket.onerror = handleDisconnect
    socket.onclose = handleDisconnect

    return () => {
      active = false
      socket.close()
    }
  }, [runId])

  return state
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useTrainingRun.test.ts`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/training/useTrainingRun.ts apps/frontend/tests/useTrainingRun.test.ts
git commit -m "frontend: add useTrainingRun WebSocket hook"
```

---

### Task 3: Training monitor UI (Recharts modal)

**Files:**
- Modify: `apps/frontend/package.json` (add `recharts`)
- Modify: `apps/frontend/src/codeview/CodeViewPanel.tsx` (shared modal
  classes)
- Modify: `apps/frontend/src/index.css` (rename `.code-view-panel` ->
  `.modal-panel`, add chart spacing)
- Create: `apps/frontend/src/training/TrainingMonitor.tsx`
- Test: `apps/frontend/tests/TrainingMonitor.test.tsx`

**Interfaces:**
- Consumes: `useTrainingRun` and `TrainingState` from
  `training/useTrainingRun.ts` (Task 2).
- Produces: `TrainingMonitor({runId: string, onClose: () => void})` —
  mounted by Task 4's `App.tsx`.

- [ ] **Step 1: Install the recharts dependency**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
npm install recharts
```

Expected: `package.json`'s `dependencies` gains a `recharts` entry.

- [ ] **Step 2: Write the failing tests**

Create `apps/frontend/tests/TrainingMonitor.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrainingMonitor } from '../src/training/TrainingMonitor'
import * as trainingRun from '../src/training/useTrainingRun'
import type { TrainingState } from '../src/training/useTrainingRun'

vi.mock('../src/training/useTrainingRun', async () => {
  const actual = await vi.importActual<typeof import('../src/training/useTrainingRun')>(
    '../src/training/useTrainingRun',
  )
  return { ...actual, useTrainingRun: vi.fn() }
})

function mockState(state: TrainingState) {
  vi.mocked(trainingRun.useTrainingRun).mockReturnValue(state)
}

describe('TrainingMonitor', () => {
  it('shows a "Training…" heading while a run is in progress', () => {
    mockState({
      status: 'running',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
    })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training…')).toBeInTheDocument()
  })

  it('shows final metrics when training completes', () => {
    mockState({
      status: 'complete',
      history: [],
      metrics: { 'n6.metrics': { accuracy: 0.9 } },
    })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training complete')).toBeInTheDocument()
    expect(screen.getByText(/n6\.metrics/)).toBeInTheDocument()
  })

  it('shows the error banner when training fails', () => {
    mockState({ status: 'error', history: [], error: 'CUDA out of memory' })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training failed')).toBeInTheDocument()
    expect(screen.getByText('CUDA out of memory')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    mockState({ status: 'connecting', history: [] })
    const onClose = vi.fn()

    render(<TrainingMonitor runId="run-1" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- TrainingMonitor.test.tsx`
Expected: FAIL — `src/training/TrainingMonitor.tsx` does not exist yet.

- [ ] **Step 4: Rename the shared modal CSS classes**

In `apps/frontend/src/index.css`, replace the `.code-view-panel` and
`.code-view-panel-header` rules (currently the last two rules in the file)
with:

```css
.modal-panel {
  position: fixed;
  inset: 0;
  background: white;
  overflow: auto;
  padding: 16px;
  z-index: 10;
}

.modal-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.training-monitor-chart {
  margin: 16px 0;
}
```

In `apps/frontend/src/codeview/CodeViewPanel.tsx`, update the two
`className` values to match:

```tsx
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export interface CodeViewPanelProps {
  code: string
  onClose: () => void
}

export function CodeViewPanel({ code, onClose }: CodeViewPanelProps) {
  return (
    <div className="modal-panel">
      <div className="modal-panel-header">
        <h2>Generated Code</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <SyntaxHighlighter language="python" style={oneDark}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
```

- [ ] **Step 5: Implement the training monitor**

Create `apps/frontend/src/training/TrainingMonitor.tsx`:

```tsx
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { useTrainingRun, type TrainingState } from './useTrainingRun'

export interface TrainingMonitorProps {
  runId: string
  onClose: () => void
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 300

function statusHeading(status: TrainingState['status']): string {
  if (status === 'complete') return 'Training complete'
  if (status === 'error') return 'Training failed'
  return 'Training…'
}

export function TrainingMonitor({ runId, onClose }: TrainingMonitorProps) {
  const state = useTrainingRun(runId)

  return (
    <div className="modal-panel">
      <div className="modal-panel-header">
        <h2>{statusHeading(state.status)}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="training-monitor-chart">
        <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={state.history}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="epoch" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="loss" name="Loss" stroke="#4a90d9" dot={false} />
          <Line type="monotone" dataKey="val_loss" name="Validation Loss" stroke="#e67e22" dot={false} />
        </LineChart>
      </div>

      {state.status === 'complete' && (
        <ul className="metrics-list">
          {Object.entries(state.metrics).map(([ref, value]) => (
            <li key={ref}>
              {ref}: {JSON.stringify(value)}
            </li>
          ))}
        </ul>
      )}

      {state.status === 'error' && <p className="error-banner">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- TrainingMonitor.test.tsx CodeViewPanel.test.tsx`
Expected: PASS (4 + 2 passed) — `CodeViewPanel.test.tsx` re-run because
Step 4 touched that component; it asserts on text/role, not class names, so
it should pass unchanged.

- [ ] **Step 7: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/package.json apps/frontend/package-lock.json \
  apps/frontend/src/training/TrainingMonitor.tsx apps/frontend/src/codeview/CodeViewPanel.tsx \
  apps/frontend/src/index.css apps/frontend/tests/TrainingMonitor.test.tsx
git commit -m "frontend: add TrainingMonitor (Recharts loss chart, recharts dep)"
```

---

### Task 4: Wire the training monitor into App

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/tests/App.test.tsx`
- Modify: `apps/frontend/tests/App.integration.test.tsx`

**Interfaces:**
- Consumes: `RunOutcome` (Task 1), `TrainingMonitor` (Task 3).
- Produces: nothing new for later tasks — this is the top-level wiring.

- [ ] **Step 1: Write the failing/updated unit tests**

Replace `apps/frontend/tests/App.test.tsx` with:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import * as client from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn(), useRunPipeline: vi.fn(), useGetCode: vi.fn() }
})

vi.mock('../src/training/TrainingMonitor', () => ({
  TrainingMonitor: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div>
      <p>Training monitor for {runId}</p>
      <button type="button" onClick={onClose}>
        Close training monitor
      </button>
    </div>
  ),
}))

function mockMutation(overrides: Partial<ReturnType<typeof client.useRunPipeline>>) {
  return {
    mutate: vi.fn(),
    isPending: false,
    data: undefined,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof client.useRunPipeline>
}

describe('App', () => {
  beforeEach(() => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)
  })

  it('renders the app heading', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByRole('heading', { name: /visual model builder/i })).toBeInTheDocument()
  })

  it('calls the run mutation with the current (empty) pipeline IR when Run is clicked', async () => {
    const runMutate = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(runMutate).toHaveBeenCalledWith(
      { nodes: [], edges: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('shows the run error message when the run mutation fails', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ error: new Error('unknown node type') }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText('unknown node type')).toBeInTheDocument()
  })

  it('renders returned metrics on a successful synchronous run', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(
      mockMutation({ data: { kind: 'sync', metrics: { 'n4.metrics': { accuracy: 0.95 } } } }),
    )
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
  })

  it('opens the training monitor when the run mutation returns an async outcome', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.getByText('Training monitor for run-1')).toBeInTheDocument()
  })

  it('opens the code view panel after a successful codegen call', async () => {
    const getCodeMutate = vi.fn((_ir, options?: { onSuccess?: () => void }) => options?.onSuccess?.())
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(
      mockMutation({ mutate: getCodeMutate, data: { code: 'print(1)' } }),
    )

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /view code/i }))

    expect(screen.getByText('Generated Code')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the failing/updated integration test**

Replace `apps/frontend/tests/App.integration.test.tsx` with:

```tsx
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

  it('opens a WebSocket to /ws/runs/{run_id} and shows the training monitor when the engine returns 202', async () => {
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- App.test.tsx App.integration.test.tsx`
Expected: FAIL — `App.tsx` doesn't import `TrainingMonitor` yet, doesn't
pass `onSuccess` to `runMutation.mutate`, and still renders
`runMutation.data.metrics` unconditionally (which no longer exists on the
`RunOutcome` type for the async case).

- [ ] **Step 4: Wire it up**

Replace `apps/frontend/src/App.tsx` with:

```tsx
import { useCallback, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { useGetCode, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { toIR } from './ir/convert'
import { NodePalette } from './palette/NodePalette'
import { TrainingMonitor } from './training/TrainingMonitor'

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const runMutation = useRunPipeline()
  const codeMutation = useGetCode()

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const handleParamChange = useCallback(
    (nodeId: string, paramName: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, params: { ...node.data.params, [paramName]: value } } }
            : node,
        ),
      )
    },
    [setNodes],
  )

  const handleRun = useCallback(() => {
    runMutation.mutate(toIR(nodes, edges), {
      onSuccess: (outcome) => {
        if (outcome.kind === 'async') {
          setActiveRunId(outcome.runId)
        }
      },
    })
  }, [nodes, edges, runMutation])

  const handleViewCode = useCallback(() => {
    codeMutation.mutate(toIR(nodes, edges), {
      onSuccess: () => setCodeViewOpen(true),
    })
  }, [nodes, edges, codeMutation])

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Visual Model Builder</h1>
        <button type="button" onClick={handleRun} disabled={runMutation.isPending}>
          {runMutation.isPending ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      {runMutation.error && <p className="error-banner">{runMutation.error.message}</p>}
      {runMutation.data?.kind === 'sync' && (
        <ul className="metrics-list">
          {Object.entries(runMutation.data.metrics).map(([ref, value]) => (
            <li key={ref}>
              {ref}: {JSON.stringify(value)}
            </li>
          ))}
        </ul>
      )}
      {codeMutation.error && <p className="error-banner">{codeMutation.error.message}</p>}

      <div className="app-body">
        <NodePalette />
        <PipelineCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={setSelectedNodeId}
        />
        <InspectorPanel node={selectedNode} onParamChange={handleParamChange} />
      </div>

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
      {activeRunId && <TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- App.test.tsx App.integration.test.tsx`
Expected: PASS (6 + 2 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/App.tsx apps/frontend/tests/App.test.tsx apps/frontend/tests/App.integration.test.tsx
git commit -m "frontend: open the training monitor on an async run outcome"
```

---

### Task 5: Layer-port edge/handle coloring

**Files:**
- Modify: `apps/frontend/src/canvas/PipelineCanvas.tsx`
- Modify: `apps/frontend/tests/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `outputPortTypeForConnection(connection, nodes): string |
  undefined`, exported for direct testing; not consumed by any other task.

- [ ] **Step 1: Write the failing tests**

In `apps/frontend/tests/PipelineCanvas.test.tsx`, add
`outputPortTypeForConnection` to the existing import from
`'../src/canvas/PipelineCanvas'` (no new testing-library imports are
needed — `render` and `screen` are already imported), and append these
blocks after the existing `describe('PipelineCanvas', ...)` block (keep
everything already in the file as-is):

```tsx
describe('outputPortTypeForConnection', () => {
  it('returns the type of the source node output port referenced by the connection', () => {
    const inputManifest: NodeManifest = {
      id: 'pytorch_models.input',
      category: 'Models (PyTorch)',
      label: 'Input',
      inputs: [{ name: 'train_table', type: 'Table' }],
      outputs: [{ name: 'architecture', type: 'Layer' }],
      params: [],
      long_running: false,
    }
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: inputManifest, params: {} },
    }

    const result = outputPortTypeForConnection(
      { source: 'n1', sourceHandle: 'architecture', target: 'n2', targetHandle: 'architecture' },
      [node],
    )

    expect(result).toBe('Layer')
  })

  it('returns undefined when the source node or port is not found', () => {
    const result = outputPortTypeForConnection(
      { source: 'missing', sourceHandle: 'x', target: 'n2', targetHandle: 'y' },
      [],
    )

    expect(result).toBeUndefined()
  })
})

describe('PipelineCanvas port/edge coloring', () => {
  it('colors a port handle by its port type', () => {
    const inputManifest: NodeManifest = {
      id: 'pytorch_models.input',
      category: 'Models (PyTorch)',
      label: 'Input',
      inputs: [{ name: 'train_table', type: 'Table' }],
      outputs: [{ name: 'architecture', type: 'Layer' }],
      params: [],
      long_running: false,
    }
    vi.mocked(client.useNodes).mockReturnValue({
      data: [inputManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: inputManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    expect(handles).toHaveLength(2)
    expect(handles[0]?.style.background).toBe('rgb(74, 144, 217)') // Table (target: train_table)
    expect(handles[1]?.style.background).toBe('rgb(155, 89, 182)') // Layer (source: architecture)
  })

  it('colors an edge by the source port type stashed in edge.data', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 140,
      height: 56,
      top: 0,
      left: 0,
      right: 140,
      bottom: 56,
      toJSON: () => {},
    })
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)

    const nodeA: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
      measured: { width: 140, height: 56 },
      handles: [{ id: 'table', type: 'source', position: Position.Right, x: 140, y: 24, width: 1, height: 1 }],
    }
    const nodeB: PipelineNode = {
      id: 'n2',
      type: 'pipelineNode',
      position: { x: 200, y: 0 },
      data: { manifest: csvManifest, params: {} },
      measured: { width: 140, height: 56 },
      handles: [{ id: 'table', type: 'target', position: Position.Left, x: 0, y: 24, width: 1, height: 1 }],
    }
    const edge: PipelineEdge = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'table',
      targetHandle: 'table',
      data: { portType: 'Table' },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[nodeA, nodeB]}
        edges={[edge]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    await screen.findByRole('button', { name: /delete connection/i })

    const edgePath = container.querySelector<SVGPathElement>('.react-flow__edge-path')
    expect(edgePath?.style.stroke).toBe('rgb(74, 144, 217)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- PipelineCanvas.test.tsx`
Expected: FAIL — `outputPortTypeForConnection` isn't exported yet, and
handles/edges don't set `background`/`stroke`.

- [ ] **Step 3: Implement the coloring**

Replace `apps/frontend/src/canvas/PipelineCanvas.tsx` with:

```tsx
import {
  addEdge,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodeConnections,
  Handle,
  Position,
  type Connection,
  type EdgeProps,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import type { Port } from '../api/types'
import { useNodes } from '../api/client'
import { createPipelineNode } from './nodeFactory'
import type { PipelineEdge, PipelineNode, PipelineNodeData } from './types'
import { isValidConnection as validateConnection } from './validation'

const PORT_TOP_OFFSET = 32
const PORT_ROW_HEIGHT = 16
const NODE_MIN_HEIGHT_PADDING = 16

// Per-port-type accent color, shared by handles and the edges connecting
// them, so a pipeline's data-vs-layer-vs-model wiring is visually
// distinguishable at a glance. rgb() (not hex) so the color read back off
// the DOM in tests matches exactly what was set, independent of any
// hex-to-rgb normalization jsdom's style engine may or may not do.
const PORT_TYPE_COLORS: Record<string, string> = {
  Table: 'rgb(74, 144, 217)',
  Layer: 'rgb(155, 89, 182)',
  Model: 'rgb(46, 204, 113)',
  Metrics: 'rgb(230, 126, 34)',
}
const DEFAULT_PORT_COLOR = 'rgb(136, 136, 136)'

function colorForPortType(portType: string | undefined): string {
  if (!portType) return DEFAULT_PORT_COLOR
  return PORT_TYPE_COLORS[portType] ?? DEFAULT_PORT_COLOR
}

export function outputPortTypeForConnection(
  connection: Connection,
  nodes: PipelineNode[],
): string | undefined {
  const sourceNode = nodes.find((node) => node.id === connection.source)
  return sourceNode?.data.manifest.outputs.find((port) => port.name === connection.sourceHandle)?.type
}

// An input port should only ever hold one incoming edge — the executor
// (engine/vmb_engine/executor.py) overwrites context[port] per edge, so a
// second connection to the same target port silently drops the first with
// no error. useNodeConnections lets React Flow itself refuse a second
// connection at the handle, without teaching validation.ts (a plain,
// library-free port-type-compatibility function) about existing edges.
function TargetPort({ port, top }: { port: Port; top: number }) {
  const connections = useNodeConnections({ handleType: 'target', handleId: port.name })
  return (
    <>
      <Handle
        id={port.name}
        type="target"
        position={Position.Left}
        isConnectableEnd={connections.length === 0}
        style={{ top, background: colorForPortType(port.type) }}
      />
      <span className="pipeline-node-port-label pipeline-node-port-label-target" style={{ top }}>
        {port.name}
      </span>
    </>
  )
}

function SourcePort({ port, top }: { port: Port; top: number }) {
  return (
    <>
      <Handle
        id={port.name}
        type="source"
        position={Position.Right}
        style={{ top, background: colorForPortType(port.type) }}
      />
      <span className="pipeline-node-port-label pipeline-node-port-label-source" style={{ top }}>
        {port.name}
      </span>
    </>
  )
}

function PipelineNodeRenderer({ id, data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  const { deleteElements } = useReactFlow()
  const portRows = Math.max(manifest.inputs.length, manifest.outputs.length, 1)
  const minHeight = PORT_TOP_OFFSET + portRows * PORT_ROW_HEIGHT + NODE_MIN_HEIGHT_PADDING
  return (
    <div className="pipeline-node" style={{ minHeight }}>
      <button
        type="button"
        aria-label="Delete node"
        className="node-delete-button nodrag nopan"
        onClick={(event) => {
          event.stopPropagation()
          void deleteElements({ nodes: [{ id }] })
        }}
      >
        ×
      </button>
      <div>{manifest.label}</div>
      {manifest.inputs.map((port, index) => (
        <TargetPort key={port.name} port={port} top={PORT_TOP_OFFSET + index * PORT_ROW_HEIGHT} />
      ))}
      {manifest.outputs.map((port, index) => (
        <SourcePort key={port.name} port={port} top={PORT_TOP_OFFSET + index * PORT_ROW_HEIGHT} />
      ))}
    </div>
  )
}

function DeleteableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const portType = typeof data?.portType === 'string' ? data.portType : undefined

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: colorForPortType(portType) }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="Delete connection"
          className="edge-delete-button nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={(event) => {
            event.stopPropagation()
            void deleteElements({ edges: [{ id }] })
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

const NODE_TYPES = { pipelineNode: PipelineNodeRenderer }
const EDGE_TYPES = { deleteable: DeleteableEdge }

export interface PipelineCanvasProps {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  onNodesChange: OnNodesChange<PipelineNode>
  onEdgesChange: OnEdgesChange<PipelineEdge>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setEdges: Dispatch<SetStateAction<PipelineEdge[]>>
  onSelectNode: (nodeId: string | null) => void
}

function PipelineCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
}: PipelineCanvasProps) {
  const { data: manifests } = useNodes()
  const { screenToFlowPosition } = useReactFlow()
  const nodeIdCounter = useRef(0)

  const handleConnect = useCallback(
    (connection: Connection) => {
      const portType = outputPortTypeForConnection(connection, nodes)
      setEdges((eds) => {
        const nextEdges = addEdge(connection, eds)
        const newEdge = nextEdges[nextEdges.length - 1]
        return nextEdges.map((edge) =>
          edge === newEdge ? { ...edge, data: { ...edge.data, portType } } : edge,
        )
      })
    },
    [nodes, setEdges],
  )

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const manifestId = event.dataTransfer.getData('application/vmb-node-type')
      const manifest = manifests?.find((m) => m.id === manifestId)
      if (!manifest) {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      nodeIdCounter.current += 1
      const newNode = createPipelineNode(manifest, `n${nodeIdCounter.current}`, position)
      setNodes((nds) => [...nds, newNode])
    },
    [manifests, screenToFlowPosition, setNodes],
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="pipeline-canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={(connection) => validateConnection(connection, nodes)}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={{ type: 'deleteable' }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- PipelineCanvas.test.tsx`
Expected: PASS (8 passed — 4 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/PipelineCanvas.tsx apps/frontend/tests/PipelineCanvas.test.tsx
git commit -m "frontend: color ports and edges by port type (Layer gets its own color)"
```

---

### Task 6: Full-suite build and dev-server smoke check

**Files:**
- No source changes expected; fix inline and re-run this task's steps if
  any check below fails.

**Interfaces:**
- Consumes: the full app (Tasks 1-5).
- Produces: a verified full test suite and production build. Nothing
  later depends on this task's output — it is the plan's final gate.

- [ ] **Step 1: Run the full test suite**

Run: `cd /home/shreyash/projects/visual_model_builder/apps/frontend && npm test`
Expected: all tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: exits 0 (runs `tsc --noEmit` across all of `src/`, re-verifying
no type errors across task boundaries — in particular the `RunOutcome`
narrowing in `App.tsx` and the `EdgeProps['data']` typing in
`PipelineCanvas.tsx`).

- [ ] **Step 3: Smoke-check the engine + frontend dev servers together**

```bash
cd /home/shreyash/projects/visual_model_builder
.venv/bin/uvicorn vmb_engine.api:app --port 8000 &
ENGINE_PID=$!
sleep 2
curl -sf http://127.0.0.1:8000/nodes | grep -q "pytorch_models.train" && echo "ENGINE OK"

cd apps/frontend
npm run dev -- --port 5173 &
DEV_PID=$!
sleep 2
curl -sf http://127.0.0.1:5173 | grep -q '<div id="root">' && echo "FRONTEND OK"

kill $ENGINE_PID $DEV_PID
```

Expected: prints `ENGINE OK` and `FRONTEND OK`.

- [ ] **Step 4: Commit (only if Steps 1-3 required fixes)**

If every check above passed with no source changes, there is nothing to
commit — this task is done. Otherwise:

```bash
cd /home/shreyash/projects/visual_model_builder
git add -A apps/frontend
git commit -m "frontend: fix issues found in full-suite/build verification"
```

---

## Manual QA (for a human, after this plan is merged)

No task above drives a real browser through an actual training run — that
needs a human. Run this once all 6 tasks are complete:

1. Start the engine: from the repo root,
   `.venv/bin/uvicorn vmb_engine.api:app --reload`.
2. Start the frontend: `cd apps/frontend && npm run dev`, open the printed
   URL (default `http://localhost:5173`).
3. Drag **CSV Loader** and **Train/Test Split** onto the canvas, then drag
   **Input**, **Linear**, **ReLU**, **Dropout**, and **Train** (all under
   "Models (PyTorch)") onto the canvas.
4. Set a CSV path on **CSV Loader** and a target column on **Input** and
   **Train** matching a real dataset (any small tabular CSV with a label
   column works).
5. Connect: CSV Loader's `table` → Train/Test Split's `table`; Train/Test
   Split's `train` → Input's `train_table`; Input's `architecture` →
   Linear's `architecture`; Linear's `architecture` → ReLU's
   `architecture`; ReLU's `architecture` → Dropout's `architecture`;
   Dropout's `architecture` → Train's `architecture`; Train/Test Split's
   `train`/`test` → Train's `train_table`/`test_table`. Confirm the
   `Layer`-typed edges (Input→Linear→ReLU→Dropout→Train) render in a
   visibly different color than the `Table`-typed edges.
6. Click **Run**. Confirm the training monitor modal opens immediately
   (not after a long blocking wait) showing "Training…", and that the
   loss/validation-loss chart updates live, epoch by epoch, as training
   proceeds.
7. Confirm the modal switches to "Training complete" and shows final
   metrics once training finishes, and that clicking **Close** dismisses
   it.
8. Run a second, non-PyTorch pipeline (e.g. just CSV Loader → Train/Test
   Split → a scikit-learn model → Evaluate) and confirm it still runs
   synchronously with no training monitor involved — the existing flow is
   unaffected.
