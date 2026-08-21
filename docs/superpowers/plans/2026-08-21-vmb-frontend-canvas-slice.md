# Frontend Canvas Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first frontend milestone — a React + React Flow canvas
(palette, port-type-validated graph, schema-driven inspector, generated-code
view) that drives the already-built Python engine
(`engine/vmb_engine`) over its HTTP API — proving the frontend can build a
pipeline, run it, and view generated code against the real engine, with no
Tauri shell, no WebSocket, and no project save/load yet.

**Architecture:** A Vite + React + TypeScript app at `apps/frontend/`. React
Flow's own controlled `nodes`/`edges` state (owned by `App`) is the working
canvas state — `ir/convert.ts` converts it to `PipelineIR` JSON only at the
two points that need it: the `/pipeline/run` and `/pipeline/codegen` request
bodies. The palette and inspector are driven entirely by each node's
`NodeManifest` (fetched from `GET /nodes`) — no frontend code names a
specific node type. TanStack Query wraps all three engine endpoints.

**Tech Stack:** Vite, React 19, TypeScript, `@xyflow/react` (React Flow v12,
package renamed from `reactflow`), `@tanstack/react-query` v5,
`react-syntax-highlighter`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-vmb-frontend-design.md`
(parent spec: `docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md`)

## Global Constraints

- Node.js v20+, npm v10+ (this environment has Node v20.20.2 / npm 10.8.2).
- All frontend code lives under `apps/frontend/`; all commands in this plan
  run from that directory unless stated otherwise. All paths below are
  relative to the repo root `/home/shreyash/projects/visual_model_builder`.
- The engine base URL is hardcoded to `http://127.0.0.1:8000` in
  `api/client.ts` — there is no Tauri shell yet, so no per-session auth
  token or dynamic port exists to plumb through (spec's explicit non-goal).
- No WebSocket, no `long_running` node handling, no project save/load, no
  Tauri packaging in this plan (spec's explicit non-goals).
- **ParamSpec gap (read before Task 6):** the engine's `ParamSpec`
  (`engine/vmb_engine/manifest.py`) only carries
  `{name, type, label, default}` — no `options` for `select`, no
  `min`/`max`/`step` for `slider`. None of the engine's 4 current nodes use
  `select`, `file_picker`, or `slider` params. This plan's frontend
  `ParamSpec` TypeScript type adds `options`/`min`/`max`/`step` as
  *optional* fields for forward compatibility, and the `select`/`slider`
  controls degrade to a plain text/number input when those fields are
  absent (true for every param today). `file_picker` always renders a
  plain text path input — there is no Tauri native file dialog in this
  browser-only slice. This is a frontend-only decision; it does not modify
  the engine.
- Dependency versions below are the latest published versions as of
  2026-08-21; use them as printed unless `npm install` reports a
  conflict, in which case use the closest compatible version and note the
  substitution in your task report.
- If a library's actual API shape (e.g. an exact generic type parameter)
  differs slightly from the code shown in a step, the shown code
  communicates intent and shape — consult the installed package's `.d.ts`
  files under `node_modules` and adapt; re-run the step's test before
  moving on.
- No E2E/browser automation in this plan. Acceptance is the unit suite
  (Vitest) passing, `npm run build` succeeding (Task 11), plus a documented
  Manual QA pass (end of this document) for a human to run afterward against
  a live browser — no task in this plan claims to have performed that pass.

## File Structure

```
apps/frontend/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    index.css
    api/
      types.ts
      client.ts
    ir/
      convert.ts
    canvas/
      types.ts
      validation.ts
      nodeFactory.ts
      PipelineCanvas.tsx
    palette/
      NodePalette.tsx
    inspector/
      InspectorPanel.tsx
      params/
        types.ts
        TextParam.tsx
        NumberParam.tsx
        SelectParam.tsx
        FilePickerParam.tsx
        CheckboxParam.tsx
        SliderParam.tsx
    codeview/
      CodeViewPanel.tsx
  tests/
    setup.ts
    App.test.tsx
    client.test.ts
    convert.test.ts
    validation.test.ts
    nodeFactory.test.ts
    InspectorPanel.test.tsx
    NodePalette.test.tsx
    PipelineCanvas.test.tsx
    CodeViewPanel.test.tsx
  manual-test-data/
    sample.csv
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/index.html`
- Create: `apps/frontend/src/index.css`
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/App.tsx`
- Create: `apps/frontend/tests/setup.ts`
- Test: `apps/frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `App` (React component, default-less named export from
  `src/App.tsx`) rendering an `<h1>Visual Model Builder</h1>` inside a
  `.app-header`. A working `npm run dev` / `npm run build` / `npm test`
  toolchain that every later task builds on.

- [ ] **Step 1: Create the package manifest**

Create `apps/frontend/package.json`:

```json
{
  "name": "vmb-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.101.4",
    "@xyflow/react": "^12.11.3",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-syntax-highlighter": "^16.1.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.5",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.4",
    "@types/react-syntax-highlighter": "^15.5.13",
    "@vitejs/plugin-react": "^6.1.0",
    "jsdom": "^30.0.1",
    "typescript": "^7.0.2",
    "vite": "^8.2.2",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Create `apps/frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`tests/` is intentionally excluded from `include` — `npm run build`'s
`tsc --noEmit` type-checks only the shipped `src/` code; Vitest transpiles
test files itself and does not require them to pass `tsc`.

- [ ] **Step 3: Create the Vite/Vitest config**

Create `apps/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 4: Create the HTML entry point**

Create `apps/frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Visual Model Builder</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create the base stylesheet**

Create `apps/frontend/src/index.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid #ccc;
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.node-palette {
  width: 220px;
  overflow-y: auto;
  border-right: 1px solid #ccc;
  padding: 8px;
}

.node-palette-item {
  padding: 4px 8px;
  margin: 4px 0;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: grab;
}

.pipeline-canvas {
  flex: 1;
  min-width: 0;
}

.pipeline-node {
  padding: 8px 12px;
  border: 1px solid #888;
  border-radius: 4px;
  background: white;
  min-width: 140px;
}

.inspector-panel {
  width: 260px;
  overflow-y: auto;
  border-left: 1px solid #ccc;
  padding: 8px;
}

.param-control {
  display: block;
  margin-bottom: 8px;
}

.param-control-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}

.error-banner {
  color: #b00020;
  padding: 4px 16px;
  margin: 0;
}

.metrics-list {
  padding: 4px 16px;
  margin: 0;
}

.code-view-panel {
  position: fixed;
  inset: 0;
  background: white;
  overflow: auto;
  padding: 16px;
  z-index: 10;
}

.code-view-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
```

- [ ] **Step 6: Create the test environment setup**

Create `apps/frontend/tests/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  // React Flow measures node dimensions via ResizeObserver, which jsdom
  // does not implement.
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock
}

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
```

- [ ] **Step 7: Write the failing smoke test**

Create `apps/frontend/tests/App.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App'

describe('App', () => {
  it('renders the app heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /visual model builder/i }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Install dependencies**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
npm install
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/App.tsx` does not exist yet (module resolution error).

- [ ] **Step 10: Implement the minimal App and entry point**

Create `apps/frontend/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Visual Model Builder</h1>
      </header>
    </div>
  )
}
```

Create `apps/frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import './index.css'
import { App } from './App'

const queryClient = new QueryClient()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('missing #root element')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (1 passed)

- [ ] **Step 12: Verify the build toolchain**

Run: `npm run build`
Expected: exits 0, produces `apps/frontend/dist/`.

- [ ] **Step 13: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend
git commit -m "Add frontend scaffolding (Vite + React + TypeScript + Vitest)"
```

---

### Task 2: API types and engine client

**Files:**
- Create: `apps/frontend/src/api/types.ts`
- Create: `apps/frontend/src/api/client.ts`
- Test: `apps/frontend/tests/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: types `Port`, `ParamSpec`, `NodeManifest`, `NodeSpec`,
  `EdgeSpec`, `PipelineIR`, `RunResult`, `CodegenResult` (all in
  `src/api/types.ts`). Functions `getNodes(): Promise<NodeManifest[]>`,
  `runPipeline(ir: PipelineIR): Promise<RunResult>`,
  `getCode(ir: PipelineIR): Promise<CodegenResult>`, and hooks
  `useNodes()`, `useRunPipeline()`, `useGetCode()` (all in
  `src/api/client.ts`), used by every later task that talks to the engine.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCode, getNodes, runPipeline } from '../src/api/client'
import type { NodeManifest, PipelineIR } from '../src/api/types'

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

  it('runPipeline POSTs the IR and returns metrics', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metrics: { 'n4.metrics': { accuracy: 0.9 } } }),
    } as Response)

    const result = await runPipeline(ir)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ir),
    })
    expect(result).toEqual({ metrics: { 'n4.metrics': { accuracy: 0.9 } } })
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- client.test.ts`
Expected: FAIL — `src/api/client.ts` does not exist yet.

- [ ] **Step 3: Implement the types**

Create `apps/frontend/src/api/types.ts`:

```typescript
export interface Port {
  name: string
  type: string
}

export interface ParamSpec {
  name: string
  type: 'text' | 'number' | 'select' | 'file_picker' | 'checkbox' | 'slider'
  label: string
  default: unknown
  // Not sent by the engine today (see this plan's Global Constraints) —
  // optional for forward compatibility.
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface NodeManifest {
  id: string
  category: string
  label: string
  inputs: Port[]
  outputs: Port[]
  params: ParamSpec[]
  long_running: boolean
}

export interface NodeSpec {
  id: string
  type: string
  params: Record<string, unknown>
}

export interface EdgeSpec {
  from: string
  to: string
}

export interface PipelineIR {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
}

export interface RunResult {
  metrics: Record<string, unknown>
}

export interface CodegenResult {
  code: string
}
```

- [ ] **Step 4: Implement the client**

Create `apps/frontend/src/api/client.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CodegenResult, NodeManifest, PipelineIR, RunResult } from './types'

const BASE_URL = 'http://127.0.0.1:8000'

export async function getNodes(): Promise<NodeManifest[]> {
  const response = await fetch(`${BASE_URL}/nodes`)
  if (!response.ok) {
    throw new Error(`GET /nodes failed: ${response.status}`)
  }
  return response.json()
}

async function postPipeline<T>(path: string, ir: PipelineIR): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
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
  return response.json()
}

export function runPipeline(ir: PipelineIR): Promise<RunResult> {
  return postPipeline<RunResult>('/pipeline/run', ir)
}

export function getCode(ir: PipelineIR): Promise<CodegenResult> {
  return postPipeline<CodegenResult>('/pipeline/codegen', ir)
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
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/api apps/frontend/tests/client.test.ts
git commit -m "Add engine API types and HTTP client"
```

---

### Task 3: Canvas node types and IR conversion

**Files:**
- Create: `apps/frontend/src/canvas/types.ts`
- Create: `apps/frontend/src/ir/convert.ts`
- Test: `apps/frontend/tests/convert.test.ts`

**Interfaces:**
- Consumes: `NodeManifest`, `NodeSpec`, `EdgeSpec`, `PipelineIR` (Task 2,
  `src/api/types.ts`).
- Produces: `PipelineNodeData` (`{manifest: NodeManifest, params:
  Record<string, unknown>}`), `PipelineNode` (`Node<PipelineNodeData>`),
  `PipelineEdge` (`Edge`) — all in `src/canvas/types.ts`, used by every
  later canvas/inspector task. `toIR(nodes: PipelineNode[], edges:
  PipelineEdge[]): PipelineIR` in `src/ir/convert.ts`, used by `App`
  (Task 10) to build request bodies for `runPipeline`/`getCode`.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/convert.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { toIR } from '../src/ir/convert'
import type { PipelineEdge, PipelineNode } from '../src/canvas/types'
import type { NodeManifest } from '../src/api/types'

const csvManifest: NodeManifest = {
  id: 'data.csv_loader',
  category: 'Data',
  label: 'CSV Loader',
  inputs: [],
  outputs: [{ name: 'table', type: 'Table' }],
  params: [{ name: 'path', type: 'text', label: 'File Path', default: '' }],
  long_running: false,
}

const splitManifest: NodeManifest = {
  id: 'data.train_test_split',
  category: 'Data',
  label: 'Train/Test Split',
  inputs: [{ name: 'table', type: 'Table' }],
  outputs: [
    { name: 'train', type: 'Table' },
    { name: 'test', type: 'Table' },
  ],
  params: [
    { name: 'test_size', type: 'number', label: 'Test Size', default: 0.2 },
    { name: 'random_state', type: 'number', label: 'Random State', default: 42 },
  ],
  long_running: false,
}

function node(id: string, manifest: NodeManifest, params: Record<string, unknown>): PipelineNode {
  return { id, type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest, params } }
}

describe('toIR', () => {
  it('converts nodes to NodeSpec, dropping position and UI state', () => {
    const nodes = [node('n1', csvManifest, { path: 'iris.csv' })]

    const ir = toIR(nodes, [])

    expect(ir.nodes).toEqual([{ id: 'n1', type: 'data.csv_loader', params: { path: 'iris.csv' } }])
  })

  it('converts edges to "node.port" from/to strings', () => {
    const nodes = [
      node('n1', csvManifest, { path: 'iris.csv' }),
      node('n2', splitManifest, { test_size: 0.2, random_state: 42 }),
    ]
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ]

    const ir = toIR(nodes, edges)

    expect(ir.edges).toEqual([{ from: 'n1.table', to: 'n2.table' }])
  })

  it('throws if an edge is missing a source or target handle', () => {
    const nodes = [node('n1', csvManifest, {})]
    const edges = [{ id: 'e1', source: 'n1', target: 'n2' } as PipelineEdge]

    expect(() => toIR(nodes, edges)).toThrow(/missing a source or target handle/)
  })

  it('round-trips param values unchanged, including non-default overrides', () => {
    const nodes = [node('n2', splitManifest, { test_size: 0.3, random_state: 7 })]

    const ir = toIR(nodes, [])

    expect(ir.nodes[0].params).toEqual({ test_size: 0.3, random_state: 7 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- convert.test.ts`
Expected: FAIL — `src/canvas/types.ts` / `src/ir/convert.ts` do not exist yet.

- [ ] **Step 3: Implement the canvas types**

Create `apps/frontend/src/canvas/types.ts`:

```typescript
import type { Edge, Node } from '@xyflow/react'
import type { NodeManifest } from '../api/types'

export interface PipelineNodeData extends Record<string, unknown> {
  manifest: NodeManifest
  params: Record<string, unknown>
}

export type PipelineNode = Node<PipelineNodeData>
export type PipelineEdge = Edge
```

- [ ] **Step 4: Implement the converter**

Create `apps/frontend/src/ir/convert.ts`:

```typescript
import type { EdgeSpec, NodeSpec, PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'

export function toIR(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineIR {
  const irNodes: NodeSpec[] = nodes.map((node) => ({
    id: node.id,
    type: node.data.manifest.id,
    params: node.data.params,
  }))

  const irEdges: EdgeSpec[] = edges.map((edge) => {
    if (!edge.sourceHandle || !edge.targetHandle) {
      throw new Error(`edge ${edge.id} is missing a source or target handle`)
    }
    return {
      from: `${edge.source}.${edge.sourceHandle}`,
      to: `${edge.target}.${edge.targetHandle}`,
    }
  })

  return { nodes: irNodes, edges: irEdges }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- convert.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/types.ts apps/frontend/src/ir apps/frontend/tests/convert.test.ts
git commit -m "Add canvas node types and pipeline IR conversion"
```

---

### Task 4: Port-type connection validation

**Files:**
- Create: `apps/frontend/src/canvas/validation.ts`
- Test: `apps/frontend/tests/validation.test.ts`

**Interfaces:**
- Consumes: `PipelineNode` (Task 3, `src/canvas/types.ts`).
- Produces: `ConnectionLike` (structural type: `{source: string | null,
  sourceHandle?: string | null, target: string | null, targetHandle?:
  string | null}`) and `isValidConnection(connection: ConnectionLike,
  nodes: PipelineNode[]): boolean`, used by `PipelineCanvas` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/validation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { isValidConnection } from '../src/canvas/validation'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest, Port } from '../src/api/types'

function manifest(id: string, outputs: Port[], inputs: Port[]): NodeManifest {
  return { id, category: 'Test', label: id, inputs, outputs, params: [], long_running: false }
}

function node(id: string, m: NodeManifest): PipelineNode {
  return { id, type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: m, params: {} } }
}

describe('isValidConnection', () => {
  const tableOut = manifest('data.csv_loader', [{ name: 'table', type: 'Table' }], [])
  const tableIn = manifest('data.train_test_split', [], [{ name: 'table', type: 'Table' }])
  const modelIn = manifest('evaluation.evaluate_classifier', [], [{ name: 'model', type: 'Model' }])

  it('accepts a connection between matching port types', () => {
    const nodes = [node('n1', tableOut), node('n2', tableIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(true)
  })

  it('rejects a connection between mismatched port types', () => {
    const nodes = [node('n1', tableOut), node('n3', modelIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n3', targetHandle: 'model' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a self-loop', () => {
    const nodes = [node('n1', tableOut)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n1', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a connection missing a handle', () => {
    const nodes = [node('n1', tableOut), node('n2', tableIn)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: null, target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })

  it('rejects a connection referencing an unknown node', () => {
    const nodes = [node('n1', tableOut)]

    const result = isValidConnection(
      { source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
      nodes,
    )

    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- validation.test.ts`
Expected: FAIL — `src/canvas/validation.ts` does not exist yet.

- [ ] **Step 3: Implement validation**

Create `apps/frontend/src/canvas/validation.ts`:

```typescript
import type { PipelineNode } from './types'

export interface ConnectionLike {
  source: string | null
  sourceHandle?: string | null
  target: string | null
  targetHandle?: string | null
}

export function isValidConnection(connection: ConnectionLike, nodes: PipelineNode[]): boolean {
  const { source, sourceHandle, target, targetHandle } = connection
  if (!source || !target || !sourceHandle || !targetHandle) {
    return false
  }
  if (source === target) {
    return false
  }

  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)
  if (!sourceNode || !targetNode) {
    return false
  }

  const outputPort = sourceNode.data.manifest.outputs.find((port) => port.name === sourceHandle)
  const inputPort = targetNode.data.manifest.inputs.find((port) => port.name === targetHandle)
  if (!outputPort || !inputPort) {
    return false
  }

  return outputPort.type === inputPort.type
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- validation.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/validation.ts apps/frontend/tests/validation.test.ts
git commit -m "Add port-type connection validation"
```

---

### Task 5: Node factory (drop-to-add defaults)

**Files:**
- Create: `apps/frontend/src/canvas/nodeFactory.ts`
- Test: `apps/frontend/tests/nodeFactory.test.ts`

**Interfaces:**
- Consumes: `NodeManifest` (Task 2), `PipelineNode` (Task 3).
- Produces: `defaultsFromManifest(manifest: NodeManifest): Record<string,
  unknown>` and `createPipelineNode(manifest: NodeManifest, id: string,
  position: {x: number, y: number}): PipelineNode`, used by
  `PipelineCanvas` (Task 8) when a palette item is dropped on the canvas.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/nodeFactory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { createPipelineNode, defaultsFromManifest } from '../src/canvas/nodeFactory'
import type { NodeManifest } from '../src/api/types'

const splitManifest: NodeManifest = {
  id: 'data.train_test_split',
  category: 'Data',
  label: 'Train/Test Split',
  inputs: [{ name: 'table', type: 'Table' }],
  outputs: [
    { name: 'train', type: 'Table' },
    { name: 'test', type: 'Table' },
  ],
  params: [
    { name: 'test_size', type: 'number', label: 'Test Size', default: 0.2 },
    { name: 'random_state', type: 'number', label: 'Random State', default: 42 },
  ],
  long_running: false,
}

describe('defaultsFromManifest', () => {
  it("builds a params object from each param spec's default", () => {
    expect(defaultsFromManifest(splitManifest)).toEqual({ test_size: 0.2, random_state: 42 })
  })

  it('returns an empty object for a manifest with no params', () => {
    expect(defaultsFromManifest({ ...splitManifest, params: [] })).toEqual({})
  })
})

describe('createPipelineNode', () => {
  it('builds a React Flow node with the given id, position, and default params', () => {
    const result = createPipelineNode(splitManifest, 'n2', { x: 100, y: 50 })

    expect(result).toEqual({
      id: 'n2',
      type: 'pipelineNode',
      position: { x: 100, y: 50 },
      data: {
        manifest: splitManifest,
        params: { test_size: 0.2, random_state: 42 },
      },
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- nodeFactory.test.ts`
Expected: FAIL — `src/canvas/nodeFactory.ts` does not exist yet.

- [ ] **Step 3: Implement the node factory**

Create `apps/frontend/src/canvas/nodeFactory.ts`:

```typescript
import type { NodeManifest } from '../api/types'
import type { PipelineNode } from './types'

export function defaultsFromManifest(manifest: NodeManifest): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const param of manifest.params) {
    params[param.name] = param.default
  }
  return params
}

export function createPipelineNode(
  manifest: NodeManifest,
  id: string,
  position: { x: number; y: number },
): PipelineNode {
  return {
    id,
    type: 'pipelineNode',
    position,
    data: {
      manifest,
      params: defaultsFromManifest(manifest),
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- nodeFactory.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/nodeFactory.ts apps/frontend/tests/nodeFactory.test.ts
git commit -m "Add node factory for drop-to-add default params"
```

---

### Task 6: Inspector param controls

**Files:**
- Create: `apps/frontend/src/inspector/params/types.ts`
- Create: `apps/frontend/src/inspector/params/TextParam.tsx`
- Create: `apps/frontend/src/inspector/params/NumberParam.tsx`
- Create: `apps/frontend/src/inspector/params/SelectParam.tsx`
- Create: `apps/frontend/src/inspector/params/FilePickerParam.tsx`
- Create: `apps/frontend/src/inspector/params/CheckboxParam.tsx`
- Create: `apps/frontend/src/inspector/params/SliderParam.tsx`
- Create: `apps/frontend/src/inspector/InspectorPanel.tsx`
- Test: `apps/frontend/tests/InspectorPanel.test.tsx`

**Interfaces:**
- Consumes: `ParamSpec` (Task 2), `PipelineNode` (Task 3). Read the
  Global Constraints section's "ParamSpec gap" note before writing
  `SelectParam`/`SliderParam`/`FilePickerParam` — their fallback behavior
  is a plan requirement, not an implementer's judgment call.
- Produces: `ParamControlProps` (`{spec: ParamSpec, value: unknown,
  onChange: (value: unknown) => void}`) and one component per param type.
  `InspectorPanel` (`{node: PipelineNode | null, onParamChange: (nodeId:
  string, paramName: string, value: unknown) => void}`), used by `App`
  (Task 10).

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/InspectorPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InspectorPanel } from '../src/inspector/InspectorPanel'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest, ParamSpec } from '../src/api/types'

function manifestWithParam(param: ParamSpec): NodeManifest {
  return {
    id: 'test.node',
    category: 'Test',
    label: 'Test Node',
    inputs: [],
    outputs: [],
    params: [param],
    long_running: false,
  }
}

function nodeWithParam(param: ParamSpec, value: unknown): PipelineNode {
  return {
    id: 'n1',
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: { manifest: manifestWithParam(param), params: { [param.name]: value } },
  }
}

describe('InspectorPanel', () => {
  it('shows a placeholder when no node is selected', () => {
    render(<InspectorPanel node={null} onParamChange={vi.fn()} />)
    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('renders a text control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'path', type: 'text', label: 'File Path', default: '' }, '')
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('File Path'), 'a')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'path', 'a')
  })

  it('renders a number control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam(
      { name: 'n_estimators', type: 'number', label: 'N Estimators', default: 100 },
      100,
    )
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('N Estimators')
    await userEvent.clear(input)
    await userEvent.type(input, '5')

    expect(onParamChange).toHaveBeenLastCalledWith('n1', 'n_estimators', 5)
  })

  it('renders a checkbox control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'shuffle', type: 'checkbox', label: 'Shuffle', default: false }, false)
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    await userEvent.click(screen.getByLabelText('Shuffle'))

    expect(onParamChange).toHaveBeenCalledWith('n1', 'shuffle', true)
  })

  it('renders a select control with options and reports changes', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'kernel',
      type: 'select',
      label: 'Kernel',
      default: 'linear',
      options: ['linear', 'rbf'],
    }
    const node = nodeWithParam(spec, 'linear')
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    await userEvent.selectOptions(screen.getByLabelText('Kernel'), 'rbf')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'rbf')
  })

  it('falls back to a text control when a select has no options', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'kernel', type: 'select', label: 'Kernel', default: '' }
    const node = nodeWithParam(spec, '')
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('Kernel')
    expect(input.tagName).toBe('INPUT')
    await userEvent.type(input, 'x')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'x')
  })

  it('renders a slider control with bounds and reports changes', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'test_size',
      type: 'slider',
      label: 'Test Size',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.1,
    }
    const node = nodeWithParam(spec, 0.2)
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    fireEvent.change(screen.getByLabelText('Test Size'), { target: { value: '0.5' } })

    expect(onParamChange).toHaveBeenCalledWith('n1', 'test_size', 0.5)
  })

  it('falls back to a number control when a slider has no bounds', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'test_size', type: 'slider', label: 'Test Size', default: 0.2 }
    const node = nodeWithParam(spec, 0.2)
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    expect(screen.getByLabelText('Test Size')).toHaveAttribute('type', 'number')
  })

  it('renders a file_picker control as a plain path input', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'folder', type: 'file_picker', label: 'Folder', default: '' }
    const node = nodeWithParam(spec, '')
    render(<InspectorPanel node={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('Folder'), '/tmp')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'folder', '/tmp')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- InspectorPanel.test.tsx`
Expected: FAIL — `src/inspector/InspectorPanel.tsx` does not exist yet.

- [ ] **Step 3: Implement the shared param control props**

Create `apps/frontend/src/inspector/params/types.ts`:

```typescript
import type { ParamSpec } from '../../api/types'

export interface ParamControlProps {
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
}
```

- [ ] **Step 4: Implement each param control**

Create `apps/frontend/src/inspector/params/TextParam.tsx`:

```tsx
import type { ParamControlProps } from './types'

export function TextParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
```

Create `apps/frontend/src/inspector/params/NumberParam.tsx`:

```tsx
import type { ParamControlProps } from './types'

export function NumberParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    </label>
  )
}
```

Create `apps/frontend/src/inspector/params/CheckboxParam.tsx`:

```tsx
import type { ParamControlProps } from './types'

export function CheckboxParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control param-control-checkbox">
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      <span>{spec.label}</span>
    </label>
  )
}
```

Create `apps/frontend/src/inspector/params/SelectParam.tsx`:

```tsx
import { TextParam } from './TextParam'
import type { ParamControlProps } from './types'

export function SelectParam({ spec, value, onChange }: ParamControlProps) {
  if (!spec.options || spec.options.length === 0) {
    // No manifest currently supplies `options` for a select param (see this
    // plan's Global Constraints); fall back to freeform text until one does.
    return <TextParam spec={spec} value={value} onChange={onChange} />
  }
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        {spec.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
```

Create `apps/frontend/src/inspector/params/SliderParam.tsx`:

```tsx
import { NumberParam } from './NumberParam'
import type { ParamControlProps } from './types'

export function SliderParam({ spec, value, onChange }: ParamControlProps) {
  if (spec.min === undefined || spec.max === undefined) {
    // No manifest currently supplies min/max for a slider param (see this
    // plan's Global Constraints); a range input without bounds isn't
    // meaningful, so fall back to a number input.
    return <NumberParam spec={spec} value={value} onChange={onChange} />
  }
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={typeof value === 'number' ? value : spec.min}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
```

Create `apps/frontend/src/inspector/params/FilePickerParam.tsx`:

```tsx
import type { ParamControlProps } from './types'

export function FilePickerParam({ spec, value, onChange }: ParamControlProps) {
  // No Tauri shell exists in this browser-only slice, so there is no native
  // file dialog available; render a plain path input instead.
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="text"
        placeholder="/path/to/file"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
```

- [ ] **Step 5: Implement the InspectorPanel dispatcher**

Create `apps/frontend/src/inspector/InspectorPanel.tsx`:

```tsx
import type { ComponentType } from 'react'
import type { ParamSpec } from '../api/types'
import type { PipelineNode } from '../canvas/types'
import { CheckboxParam } from './params/CheckboxParam'
import { FilePickerParam } from './params/FilePickerParam'
import { NumberParam } from './params/NumberParam'
import { SelectParam } from './params/SelectParam'
import { SliderParam } from './params/SliderParam'
import { TextParam } from './params/TextParam'
import type { ParamControlProps } from './params/types'

const CONTROLS: Record<ParamSpec['type'], ComponentType<ParamControlProps>> = {
  text: TextParam,
  number: NumberParam,
  select: SelectParam,
  file_picker: FilePickerParam,
  checkbox: CheckboxParam,
  slider: SliderParam,
}

export interface InspectorPanelProps {
  node: PipelineNode | null
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
}

export function InspectorPanel({ node, onParamChange }: InspectorPanelProps) {
  if (!node) {
    return (
      <aside className="inspector-panel">
        <p>Select a node to edit its parameters.</p>
      </aside>
    )
  }

  const { manifest, params } = node.data

  return (
    <aside className="inspector-panel">
      <h2>{manifest.label}</h2>
      {manifest.params.map((spec) => {
        const Control = CONTROLS[spec.type]
        return (
          <Control
            key={spec.name}
            spec={spec}
            value={params[spec.name]}
            onChange={(value) => onParamChange(node.id, spec.name, value)}
          />
        )
      })}
    </aside>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- InspectorPanel.test.tsx`
Expected: PASS (9 passed)

- [ ] **Step 7: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/inspector apps/frontend/tests/InspectorPanel.test.tsx
git commit -m "Add schema-driven inspector param controls"
```

---

### Task 7: Node palette

**Files:**
- Create: `apps/frontend/src/palette/NodePalette.tsx`
- Test: `apps/frontend/tests/NodePalette.test.tsx`

**Interfaces:**
- Consumes: `useNodes()` (Task 2, `src/api/client.ts`), `NodeManifest`
  (Task 2).
- Produces: `groupByCategory(manifests: NodeManifest[]): Map<string,
  NodeManifest[]>` and `NodePalette` (React component, no props — calls
  `useNodes()` itself), used by `App` (Task 10). Draggable items set
  `event.dataTransfer` key `'application/vmb-node-type'` to the manifest's
  `id`, read by `PipelineCanvas`'s drop handler (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/NodePalette.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- NodePalette.test.tsx`
Expected: FAIL — `src/palette/NodePalette.tsx` does not exist yet.

- [ ] **Step 3: Implement the palette**

Create `apps/frontend/src/palette/NodePalette.tsx`:

```tsx
import type { DragEvent } from 'react'
import { useNodes } from '../api/client'
import type { NodeManifest } from '../api/types'

export function groupByCategory(manifests: NodeManifest[]): Map<string, NodeManifest[]> {
  const groups = new Map<string, NodeManifest[]>()
  for (const manifest of manifests) {
    const existing = groups.get(manifest.category) ?? []
    existing.push(manifest)
    groups.set(manifest.category, existing)
  }
  return groups
}

function handleDragStart(event: DragEvent, manifestId: string) {
  event.dataTransfer.setData('application/vmb-node-type', manifestId)
  event.dataTransfer.effectAllowed = 'move'
}

export function NodePalette() {
  const { data: manifests, isLoading, error } = useNodes()

  if (isLoading) {
    return (
      <aside className="node-palette">
        <p>Loading nodes…</p>
      </aside>
    )
  }

  if (error || !manifests) {
    return (
      <aside className="node-palette">
        <p className="error-banner">
          Can't reach engine at http://127.0.0.1:8000 — is it running?
        </p>
      </aside>
    )
  }

  const groups = groupByCategory(manifests)

  return (
    <aside className="node-palette">
      {Array.from(groups.entries()).map(([category, categoryManifests]) => (
        <div key={category}>
          <h3>{category}</h3>
          {categoryManifests.map((manifest) => (
            <div
              key={manifest.id}
              className="node-palette-item"
              draggable
              onDragStart={(event) => handleDragStart(event, manifest.id)}
            >
              {manifest.label}
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- NodePalette.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/palette apps/frontend/tests/NodePalette.test.tsx
git commit -m "Add node palette grouped by category"
```

---

### Task 8: Pipeline canvas (React Flow wrapper)

**Files:**
- Create: `apps/frontend/src/canvas/PipelineCanvas.tsx`
- Test: `apps/frontend/tests/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `isValidConnection` (Task 4), `createPipelineNode` (Task 5),
  `useNodes` (Task 2), `PipelineNode`/`PipelineEdge` (Task 3).
- Produces: `PipelineCanvas` (React component, props `{nodes:
  PipelineNode[], edges: PipelineEdge[], onNodesChange: OnNodesChange
  <PipelineNode>, onEdgesChange: OnEdgesChange<PipelineEdge>, setNodes:
  Dispatch<SetStateAction<PipelineNode[]>>, setEdges:
  Dispatch<SetStateAction<PipelineEdge[]>>, onSelectNode: (nodeId: string
  | null) => void}`), used by `App` (Task 10). Internally wraps itself in
  `ReactFlowProvider` — callers do not need to provide one.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/PipelineCanvas.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineCanvas } from '../src/canvas/PipelineCanvas'
import * as client from '../src/api/client'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest } from '../src/api/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn() }
})

const csvManifest: NodeManifest = {
  id: 'data.csv_loader',
  category: 'Data',
  label: 'CSV Loader',
  inputs: [],
  outputs: [{ name: 'table', type: 'Table' }],
  params: [],
  long_running: false,
}

function noop() {}

describe('PipelineCanvas', () => {
  it('renders the React Flow pane with no nodes', () => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)

    const { container } = render(
      <PipelineCanvas
        nodes={[]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    expect(container.querySelector('.react-flow')).not.toBeNull()
  })

  it('renders a node label for a node already on the canvas', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const existingNode: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
    }

    render(
      <PipelineCanvas
        nodes={[existingNode]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    expect(screen.getByText('CSV Loader')).toBeInTheDocument()
  })
})
```

If `@xyflow/react` needs a browser DOM API this project's jsdom setup
doesn't provide (beyond `ResizeObserver`/`matchMedia`, already mocked in
`tests/setup.ts`), add the missing mock there following the same pattern
and note the addition in your task report.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- PipelineCanvas.test.tsx`
Expected: FAIL — `src/canvas/PipelineCanvas.tsx` does not exist yet.

- [ ] **Step 3: Implement the canvas**

Create `apps/frontend/src/canvas/PipelineCanvas.tsx`:

```tsx
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { useNodes } from '../api/client'
import { createPipelineNode } from './nodeFactory'
import type { PipelineEdge, PipelineNode, PipelineNodeData } from './types'
import { isValidConnection as validateConnection } from './validation'

function PipelineNodeRenderer({ data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  return (
    <div className="pipeline-node">
      <div>{manifest.label}</div>
      {manifest.inputs.map((port, index) => (
        <Handle key={port.name} id={port.name} type="target" position={Position.Left} style={{ top: 24 + index * 16 }} />
      ))}
      {manifest.outputs.map((port, index) => (
        <Handle key={port.name} id={port.name} type="source" position={Position.Right} style={{ top: 24 + index * 16 }} />
      ))}
    </div>
  )
}

const NODE_TYPES = { pipelineNode: PipelineNodeRenderer }

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
      setEdges((eds) => [
        ...eds,
        {
          id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
          source: connection.source,
          sourceHandle: connection.sourceHandle,
          target: connection.target,
          targetHandle: connection.targetHandle,
        },
      ])
    },
    [setEdges],
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
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/PipelineCanvas.tsx apps/frontend/tests/PipelineCanvas.test.tsx
git commit -m "Add pipeline canvas React Flow wrapper"
```

---

### Task 9: Code view panel

**Files:**
- Create: `apps/frontend/src/codeview/CodeViewPanel.tsx`
- Test: `apps/frontend/tests/CodeViewPanel.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CodeViewPanel` (React component, props `{code: string,
  onClose: () => void}`), used by `App` (Task 10).

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/CodeViewPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeViewPanel } from '../src/codeview/CodeViewPanel'

describe('CodeViewPanel', () => {
  it('renders the given code', () => {
    const { container } = render(<CodeViewPanel code="import pandas as pd" onClose={vi.fn()} />)
    expect(container.textContent).toContain('import pandas as pd')
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<CodeViewPanel code="x = 1" onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- CodeViewPanel.test.tsx`
Expected: FAIL — `src/codeview/CodeViewPanel.tsx` does not exist yet.

- [ ] **Step 3: Implement the panel**

Create `apps/frontend/src/codeview/CodeViewPanel.tsx`:

```tsx
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export interface CodeViewPanelProps {
  code: string
  onClose: () => void
}

export function CodeViewPanel({ code, onClose }: CodeViewPanelProps) {
  return (
    <div className="code-view-panel">
      <div className="code-view-panel-header">
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- CodeViewPanel.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/codeview apps/frontend/tests/CodeViewPanel.test.tsx
git commit -m "Add generated-code view panel"
```

---

### Task 10: App wiring

**Files:**
- Modify: `apps/frontend/src/App.tsx` (created in Task 1)
- Modify: `apps/frontend/tests/App.test.tsx` (created in Task 1)

**Interfaces:**
- Consumes: `NodePalette` (Task 7), `PipelineCanvas` (Task 8),
  `InspectorPanel` (Task 6), `CodeViewPanel` (Task 9), `toIR` (Task 3),
  `useRunPipeline`/`useGetCode` (Task 2).
- Produces: the fully wired `App` component — layout, Run button, View
  Code button, metrics display, error banners. Nothing later consumes
  `App` directly.

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/tests/App.test.tsx`:

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

    expect(runMutate).toHaveBeenCalledWith({ nodes: [], edges: [] })
  })

  it('shows the run error message when the run mutation fails', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ error: new Error('unknown node type') }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText('unknown node type')).toBeInTheDocument()
  })

  it('renders returned metrics on a successful run', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(
      mockMutation({ data: { metrics: { 'n4.metrics': { accuracy: 0.95 } } } }),
    )
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- App.test.tsx`
Expected: FAIL — `App` doesn't yet call `useRunPipeline`/`useGetCode` or
render a Run/View Code button.

- [ ] **Step 3: Implement the full App**

Replace `apps/frontend/src/App.tsx`:

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

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)

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
    runMutation.mutate(toIR(nodes, edges))
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
      {runMutation.data && (
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
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- App.test.tsx`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full frontend test suite**

Run: `npm test`
Expected: all tests across every task pass.

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/App.tsx apps/frontend/tests/App.test.tsx
git commit -m "Wire up App: layout, Run, View Code, error banners"
```

---

### Task 11: Production build, dev-server smoke check, and manual QA fixture

**Files:**
- Create: `apps/frontend/manual-test-data/sample.csv`
- No source changes expected; fix inline and re-run this task's steps if
  any check below fails.

**Interfaces:**
- Consumes: the full app (Tasks 1-10).
- Produces: a verified production build and a fixture file used by the
  Manual QA section below. Nothing later in this plan depends on this
  task's output — it is the plan's final gate.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (from repo root: `cd apps/frontend && npm test`).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: exits 0 (this runs `tsc --noEmit` across all of `src/`, so it
also re-verifies there are no type errors across task boundaries).

- [ ] **Step 3: Smoke-check the engine dev server**

```bash
cd /home/shreyash/projects/visual_model_builder
.venv/bin/pip install -e "engine[dev]" --quiet
.venv/bin/uvicorn vmb_engine.api:app --port 8000 &
ENGINE_PID=$!
sleep 2
curl -sf http://127.0.0.1:8000/nodes | grep -q "data.csv_loader" && echo "ENGINE OK"
kill $ENGINE_PID
```

Expected: prints `ENGINE OK`. If `.venv` doesn't exist yet, create it first
per `CLAUDE.md`'s setup command (`python3 -m venv .venv`) before the
`pip install` above.

- [ ] **Step 4: Smoke-check the frontend dev server**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
npm run dev -- --port 5173 &
DEV_PID=$!
sleep 2
curl -sf http://127.0.0.1:5173 | grep -q '<div id="root">' && echo "FRONTEND OK"
kill $DEV_PID
```

Expected: prints `FRONTEND OK`.

- [ ] **Step 5: Create the manual QA fixture**

Create `apps/frontend/manual-test-data/sample.csv`:

```csv
a,b,label
0,0,0
1,2,1
2,4,0
3,6,1
4,8,0
5,10,1
6,12,0
7,14,1
8,16,0
9,18,1
10,20,0
11,22,1
12,24,0
13,26,1
14,28,0
15,30,1
16,32,0
17,34,1
18,36,0
19,38,1
20,40,0
21,42,1
22,44,0
23,46,1
24,48,0
25,50,1
26,52,0
27,54,1
28,56,0
29,58,1
30,60,0
31,62,1
32,64,0
33,66,1
34,68,0
35,70,1
36,72,0
37,74,1
38,76,0
39,78,1
```

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/manual-test-data
git commit -m "Add manual QA fixture; verify build and dev-server smoke checks"
```

---

## Manual QA (for a human, after this plan is merged)

No task above performs this pass — it needs a real browser. Run it once
all 11 tasks are complete:

1. Start the engine: from the repo root,
   `.venv/bin/uvicorn vmb_engine.api:app --reload`.
2. Start the frontend: `cd apps/frontend && npm run dev`, open the printed
   URL (default `http://localhost:5173`).
3. Drag **CSV Loader**, **Train/Test Split**, **Random Forest**, and
   **Evaluate Classifier** onto the canvas.
4. Connect: CSV Loader's `table` → Train/Test Split's `table`; Train/Test
   Split's `train` → Random Forest's `train_table`; Random Forest's
   `model` → Evaluate Classifier's `model`; Train/Test Split's `test` →
   Evaluate Classifier's `test_table`.
5. Select CSV Loader, set **File Path** to the absolute path of
   `apps/frontend/manual-test-data/sample.csv`.
6. Select Random Forest and Evaluate Classifier, set **Target Column** to
   `label` on both.
7. Click **Run**. Expect a metrics list showing `n4.metrics` (node ids may
   differ) with an `accuracy` between 0 and 1, and no error banner.
8. Click **View Code**. Expect a read-only panel showing a Python script
   containing `RandomForestClassifier` and `accuracy_score`.
9. Stop the engine process, reload the frontend page. Expect the palette
   to show "Can't reach engine at http://127.0.0.1:8000 — is it running?"
   instead of an empty or stuck palette.
