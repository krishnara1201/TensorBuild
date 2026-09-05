# .vmb Project Save/Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a TensorBuild pipeline (nodes, params, edges, canvas layout) be saved to and loaded from a `.vmb` project file, natively in the Tauri shell and via download/upload in plain-browser dev mode.

**Architecture:** A new frontend-only `VmbProjectFile` type wraps the existing `PipelineIR` plus a node-position `layout` map; pure conversion functions (`toVmbFile`/`fromVmbFile`) live beside the existing `toIR`. Two new trusted Tauri commands (`read_vmb_file`/`write_vmb_file`, plain `std::fs`, no new Rust dependency or capability config — the same trust tier as the existing `engine_base_url` command) back native file I/O; a `persistence/vmbIo.ts` module picks between that and a browser download/upload fallback via the existing `isTauri()` pattern. `App.tsx` gains dirty-state tracking and Save/Save As/Open/New toolbar wiring.

**Tech Stack:** React + TypeScript (frontend), Rust/Tauri v2 (shell), Vitest + Testing Library (frontend tests). No engine (Python) changes.

**Spec:** `docs/superpowers/specs/2026-09-03-vmb-save-load-design.md`

## Global Constraints

- `.vmb` files are JSON: `{ version: 1, ir: PipelineIR, layout: Record<nodeId, {x,y}> }`. `PipelineIR` itself (`apps/frontend/src/api/types.ts`, `engine/vmb_engine/ir.py`) is **not** modified.
- A load either fully succeeds or fully fails with one clear error — never partially render a broken canvas.
- No new capability/permission config and no new Rust crate dependency — file I/O goes through two new plain-`std::fs` Tauri commands, exactly like the existing `engine_base_url` command's trust tier.
- Outside Tauri (`isTauri()` false), Save/Save As both trigger a browser download (no path is ever remembered); Open uses a hidden `<input type="file">`.
- All new frontend tests live in `apps/frontend/tests/` (flat directory, not colocated) — this repo's existing convention.

---

## Task 1: `.vmb` file type and pure conversion functions

**Files:**
- Create: `apps/frontend/src/ir/types.ts`
- Modify: `apps/frontend/src/ir/convert.ts`
- Test: `apps/frontend/tests/convert.test.ts` (existing file — append)

**Interfaces:**
- Consumes: `PipelineIR`, `NodeSpec`, `EdgeSpec`, `NodeManifest` (`apps/frontend/src/api/types.ts`); `PipelineNode`, `PipelineEdge` (`apps/frontend/src/canvas/types.ts`); existing `toIR(nodes, edges): PipelineIR` (`apps/frontend/src/ir/convert.ts`).
- Produces: `VMB_FILE_VERSION: number`, `VmbLayout`, `VmbProjectFile`, `FromVmbResult` (`apps/frontend/src/ir/types.ts`); `toVmbFile(nodes: PipelineNode[], edges: PipelineEdge[]): VmbProjectFile` and `fromVmbFile(raw: unknown, manifests: NodeManifest[]): FromVmbResult` (`apps/frontend/src/ir/convert.ts`) — used by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/tests/convert.test.ts` (it already imports `describe, expect, it` from vitest, `toIR` from `../src/ir/convert`, and the `csvManifest`/`splitManifest`/`node` helpers used below — add these imports alongside the existing ones):

```ts
import { fromVmbFile, toVmbFile } from '../src/ir/convert'
```

```ts
describe('toVmbFile', () => {
  it('wraps toIR output with version and per-node layout positions', () => {
    const nodes = [{ ...node('n1', csvManifest, { path: 'iris.csv' }), position: { x: 10, y: 20 } }]

    const file = toVmbFile(nodes, [])

    expect(file).toEqual({
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: { path: 'iris.csv' } }], edges: [] },
      layout: { n1: { x: 10, y: 20 } },
    })
  })
})

describe('fromVmbFile', () => {
  const manifests = [csvManifest, splitManifest]

  it('round-trips a file produced by toVmbFile back to equivalent nodes/edges', () => {
    const nodes = [
      { ...node('n1', csvManifest, { path: 'iris.csv' }), position: { x: 10, y: 20 } },
      { ...node('n2', splitManifest, { test_size: 0.2, random_state: 42 }), position: { x: 200, y: 20 } },
    ]
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ]

    const file = toVmbFile(nodes, edges)
    const result = fromVmbFile(file, manifests)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes).toEqual([
      {
        id: 'n1',
        type: 'pipelineNode',
        position: { x: 10, y: 20 },
        data: { manifest: csvManifest, params: { path: 'iris.csv' } },
      },
      {
        id: 'n2',
        type: 'pipelineNode',
        position: { x: 200, y: 20 },
        data: { manifest: splitManifest, params: { test_size: 0.2, random_state: 42 } },
      },
    ])
    expect(result.edges).toEqual([
      { id: 'n1:table->n2:table', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'table' },
    ])
  })

  it('fails with a clear error when the file references an unknown node type', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'pytorch_models.gru', params: {} }], edges: [] },
      layout: { n1: { x: 0, y: 0 } },
    }

    expect(fromVmbFile(file, manifests)).toEqual({ ok: false, error: 'Unknown node types: pytorch_models.gru' })
  })

  it('lists every unknown node type, not just the first', () => {
    const file = {
      version: 1,
      ir: {
        nodes: [
          { id: 'n1', type: 'pytorch_models.gru', params: {} },
          { id: 'n2', type: 'evaluation.f1_score', params: {} },
        ],
        edges: [],
      },
      layout: {},
    }

    expect(fromVmbFile(file, manifests)).toEqual({
      ok: false,
      error: 'Unknown node types: pytorch_models.gru, evaluation.f1_score',
    })
  })

  it('fails with a clear error on an unsupported version', () => {
    const file = { version: 99, ir: { nodes: [], edges: [] }, layout: {} }

    expect(fromVmbFile(file, manifests)).toEqual({
      ok: false,
      error: 'Unsupported project file version 99 (this build supports version 1).',
    })
  })

  it('fails with a clear error when the file is not a JSON object', () => {
    const expected = { ok: false, error: 'This file is not a valid TensorBuild project (not a JSON object).' }
    expect(fromVmbFile('not an object', manifests)).toEqual(expected)
    expect(fromVmbFile(null, manifests)).toEqual(expected)
    expect(fromVmbFile([1, 2, 3], manifests)).toEqual(expected)
  })

  it('fails with a clear error when pipeline data is missing', () => {
    expect(fromVmbFile({ version: 1 }, manifests)).toEqual({
      ok: false,
      error: 'This file is not a valid TensorBuild project (missing pipeline data).',
    })
  })

  it('defaults a node with no layout entry to {x: 0, y: 0} rather than failing', () => {
    const file = {
      version: 1,
      ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
      layout: {},
    }

    const result = fromVmbFile(file, manifests)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- convert.test.ts`
Expected: FAIL — `toVmbFile`/`fromVmbFile` are not exported from `../src/ir/convert`.

- [ ] **Step 3: Create `apps/frontend/src/ir/types.ts`**

```ts
import type { PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'

export const VMB_FILE_VERSION = 1

export type VmbLayout = Record<string, { x: number; y: number }>

export interface VmbProjectFile {
  version: number
  ir: PipelineIR
  layout: VmbLayout
}

export type FromVmbResult =
  | { ok: true; nodes: PipelineNode[]; edges: PipelineEdge[] }
  | { ok: false; error: string }
```

- [ ] **Step 4: Implement `toVmbFile`/`fromVmbFile` in `apps/frontend/src/ir/convert.ts`**

The file currently ends after `toIR`'s closing brace. Add these imports to the top of the file (alongside the existing `EdgeSpec, NodeSpec, PipelineIR` import from `'../api/types'`) and append the new code after `toIR`:

```ts
import type { EdgeSpec, NodeManifest, NodeSpec, PipelineIR } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { VMB_FILE_VERSION, type FromVmbResult, type VmbProjectFile } from './types'
```

```ts
export function toVmbFile(nodes: PipelineNode[], edges: PipelineEdge[]): VmbProjectFile {
  const layout: VmbProjectFile['layout'] = {}
  for (const node of nodes) {
    layout[node.id] = { x: node.position.x, y: node.position.y }
  }
  return { version: VMB_FILE_VERSION, ir: toIR(nodes, edges), layout }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitRef(ref: string): { id: string; port: string } {
  const dotIndex = ref.lastIndexOf('.')
  return { id: ref.slice(0, dotIndex), port: ref.slice(dotIndex + 1) }
}

export function fromVmbFile(raw: unknown, manifests: NodeManifest[]): FromVmbResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'This file is not a valid TensorBuild project (not a JSON object).' }
  }

  const { version, ir, layout } = raw as { version?: unknown; ir?: unknown; layout?: unknown }

  if (typeof version !== 'number') {
    return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
  }
  if (version !== VMB_FILE_VERSION) {
    return {
      ok: false,
      error: `Unsupported project file version ${version} (this build supports version ${VMB_FILE_VERSION}).`,
    }
  }
  if (!isPlainObject(ir) || !Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) {
    return { ok: false, error: 'This file is not a valid TensorBuild project (missing pipeline data).' }
  }

  const layoutMap: VmbProjectFile['layout'] = isPlainObject(layout) ? (layout as VmbProjectFile['layout']) : {}
  const irNodes = ir.nodes as NodeSpec[]
  const irEdges = ir.edges as EdgeSpec[]

  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const missingTypes = [...new Set(irNodes.map((node) => node.type).filter((type) => !manifestById.has(type)))]
  if (missingTypes.length > 0) {
    return { ok: false, error: `Unknown node types: ${missingTypes.join(', ')}` }
  }

  const nodes: PipelineNode[] = irNodes.map((node) => ({
    id: node.id,
    type: 'pipelineNode',
    position: layoutMap[node.id] ?? { x: 0, y: 0 },
    data: {
      manifest: manifestById.get(node.type)!,
      params: node.params,
    },
  }))

  const edges: PipelineEdge[] = irEdges.map((edge) => {
    const from = splitRef(edge.from)
    const to = splitRef(edge.to)
    return {
      id: `${from.id}:${from.port}->${to.id}:${to.port}`,
      source: from.id,
      sourceHandle: from.port,
      target: to.id,
      targetHandle: to.port,
    }
  })

  return { ok: true, nodes, edges }
}
```

Note: the "missing `version`" and "not a number" cases share the same error message as "missing pipeline data" — both are symptoms of the same underlying problem (not a well-formed `.vmb` file) and a hand-edited or corrupted file could trip either check first; one message avoids implying a distinction that doesn't matter to the user.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- convert.test.ts`
Expected: PASS (all `toIR`, `toVmbFile`, `fromVmbFile` tests)

- [ ] **Step 6: Type-check**

Run: `cd apps/frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/ir/types.ts apps/frontend/src/ir/convert.ts apps/frontend/tests/convert.test.ts
git commit -m "feat: add .vmb project file type and toVmbFile/fromVmbFile conversion"
```

---

## Task 2: Derive new-node ids from canvas state instead of a ref counter

**Why this task exists:** dropping a new node currently mints its id from a `useRef` counter (`n${nodeIdCounter.current}`) that only ever increments. After Task 6 wires up Open, a loaded file can introduce ids like `n1`..`n5`; the ref counter has no way to know about them and would immediately collide (minting `n1` again for the next dropped node). Replacing it with a pure function that derives the next id from the *current* `nodes` array fixes this for both drops and loads, with no counter state to keep in sync.

**Files:**
- Modify: `apps/frontend/src/canvas/nodeFactory.ts`
- Modify: `apps/frontend/src/canvas/PipelineCanvas.tsx:20` (import line), `:203-206` (remove the ref), `:231-243` (`handleDrop`)
- Test: `apps/frontend/tests/nodeFactory.test.ts` (existing file — append)

**Interfaces:**
- Consumes: `PipelineNode` (`apps/frontend/src/canvas/types.ts`).
- Produces: `nextNodeId(nodes: PipelineNode[]): string` (`apps/frontend/src/canvas/nodeFactory.ts`) — used by `PipelineCanvas.tsx`'s `handleDrop`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/tests/nodeFactory.test.ts` (it already imports `createPipelineNode, defaultsFromManifest` and has `splitManifest`):

```ts
import { nextNodeId } from '../src/canvas/nodeFactory'
import type { PipelineNode } from '../src/canvas/types'

describe('nextNodeId', () => {
  it('returns n1 for an empty canvas', () => {
    expect(nextNodeId([])).toBe('n1')
  })

  it('returns one past the highest existing numeric suffix', () => {
    const nodes: PipelineNode[] = [
      { id: 'n1', type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: splitManifest, params: {} } },
      { id: 'n3', type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifest: splitManifest, params: {} } },
    ]

    expect(nextNodeId(nodes)).toBe('n4')
  })

  it('ignores node ids that do not match the n<number> pattern (e.g. loaded from a hand-edited file)', () => {
    const nodes: PipelineNode[] = [
      {
        id: 'custom_node',
        type: 'pipelineNode',
        position: { x: 0, y: 0 },
        data: { manifest: splitManifest, params: {} },
      },
    ]

    expect(nextNodeId(nodes)).toBe('n1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- nodeFactory.test.ts`
Expected: FAIL — `nextNodeId` is not exported from `../src/canvas/nodeFactory`.

- [ ] **Step 3: Implement `nextNodeId` in `apps/frontend/src/canvas/nodeFactory.ts`**

Append to the file:

```ts
const NODE_ID_PATTERN = /^n(\d+)$/

export function nextNodeId(nodes: PipelineNode[]): string {
  const maxSuffix = nodes.reduce((max, node) => {
    const match = NODE_ID_PATTERN.exec(node.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `n${maxSuffix + 1}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- nodeFactory.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `nextNodeId` into `PipelineCanvas.tsx`, removing the ref counter**

Change the import on line 20 from:
```ts
import { useCallback, useMemo, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
```
to:
```ts
import { useCallback, useMemo, type Dispatch, type DragEvent, type SetStateAction } from 'react'
```

Change line 23 from:
```ts
import { createPipelineNode } from './nodeFactory'
```
to:
```ts
import { createPipelineNode, nextNodeId } from './nodeFactory'
```

Delete line 206 (`const nodeIdCounter = useRef(0)`).

Change `handleDrop` (lines 231-243) from:
```ts
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
```
to:
```ts
  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const manifestId = event.dataTransfer.getData('application/vmb-node-type')
      const manifest = manifests?.find((m) => m.id === manifestId)
      if (!manifest) {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const newNode = createPipelineNode(manifest, nextNodeId(nodes), position)
      setNodes((nds) => [...nds, newNode])
    },
    [manifests, nodes, screenToFlowPosition, setNodes],
  )
```

- [ ] **Step 6: Type-check and run the full frontend suite**

Run: `cd apps/frontend && npm run build && npm test`
Expected: build succeeds; all existing tests still pass (no test in this repo currently exercises the exact minted id from a drop event, so this refactor should not need any other test changes)

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/canvas/nodeFactory.ts apps/frontend/src/canvas/PipelineCanvas.tsx apps/frontend/tests/nodeFactory.test.ts
git commit -m "refactor: derive new-node ids from canvas state instead of a ref counter"
```

---

## Task 3: Tauri shell commands for reading/writing a `.vmb` file

**Files:**
- Modify: `apps/shell/src-tauri/src/main.rs`

**Interfaces:**
- Produces: two new Tauri commands invokable from the frontend via `@tauri-apps/api/core`'s `invoke`: `read_vmb_file(path: string): Promise<string>`, `write_vmb_file(path: string, contents: string): Promise<void>` — used by Task 4.

No capability/permission file changes and no new Cargo dependency are needed: these are plain app-defined `#[tauri::command]`s (the same trust tier as the existing `engine_base_url` command in this file, which also needs no capability entry), using `std::fs` directly rather than going through the `tauri-plugin-fs` JS-facing plugin (which would require scope configuration for arbitrary user-chosen paths).

- [ ] **Step 1: Add the two commands**

In `apps/shell/src-tauri/src/main.rs`, add below the existing `engine_base_url` command (which currently reads):
```rust
#[tauri::command]
fn engine_base_url(port: tauri::State<EnginePort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}
```
add immediately after it:
```rust
#[tauri::command]
fn read_vmb_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|err| format!("failed to read {path}: {err}"))
}

#[tauri::command]
fn write_vmb_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|err| format!("failed to write {path}: {err}"))
}
```

- [ ] **Step 2: Register the commands**

Change:
```rust
        .invoke_handler(tauri::generate_handler![engine_base_url])
```
to:
```rust
        .invoke_handler(tauri::generate_handler![engine_base_url, read_vmb_file, write_vmb_file])
```

- [ ] **Step 3: Verify the shell compiles**

Run: `cd apps/shell/src-tauri && cargo check`
Expected: compiles with no errors (this only type-checks the Rust side; it does not require the frontend dev server or the engine to be running)

- [ ] **Step 4: Commit**

```bash
git add apps/shell/src-tauri/src/main.rs
git commit -m "feat: add read_vmb_file/write_vmb_file Tauri commands"
```

---

## Task 4: Frontend persistence I/O module (Tauri + browser fallback)

**Files:**
- Create: `apps/frontend/src/persistence/vmbIo.ts`
- Test: `apps/frontend/tests/vmbIo.test.ts`

**Interfaces:**
- Consumes: `VmbProjectFile` (`apps/frontend/src/ir/types.ts`, Task 1); `isTauri` (`@tauri-apps/api/core`); `invoke` (`@tauri-apps/api/core`); `open`, `save` (`@tauri-apps/plugin-dialog`).
- Produces (used by Task 6/`App.tsx`):
  - `type SaveOutcome = { ok: true; path: string | null } | { ok: false }`
  - `type OpenOutcome = { ok: true; path: string | null; raw: unknown } | { ok: false; error?: string }`
  - `saveProjectAs(file: VmbProjectFile): Promise<SaveOutcome>`
  - `saveProject(file: VmbProjectFile, currentPath: string | null): Promise<SaveOutcome>`
  - `openProject(): Promise<OpenOutcome>`

**Design notes:**
- `saveProjectAs`: in Tauri, prompts via `save()` (filtered to `.vmb`); a cancelled dialog resolves `null` → `{ok: false}`. Otherwise writes via `invoke('write_vmb_file', ...)` and returns `{ok: true, path}`. Outside Tauri, triggers a `Blob` + temporary `<a download>` and returns `{ok: true, path: null}` — there is no cancellation signal for a browser download, so this path always reports success once triggered.
- `saveProject`: if `currentPath` is set and running in Tauri, writes straight to it (no dialog) and returns `{ok: true, path: currentPath}`. Otherwise delegates to `saveProjectAs` (this covers both "no path yet" in Tauri and "always prompt" in the browser).
- `openProject`: in Tauri, prompts via `open()` (filtered to `.vmb`); a cancelled dialog resolves `null` → `{ok: false}`. Otherwise reads via `invoke('read_vmb_file', ...)`, `JSON.parse`s it, and returns `{ok: true, path, raw}`; a parse error returns `{ok: false, error: <message>}`. Outside Tauri, uses a hidden `<input type="file" accept=".vmb">` + `FileReader`; a cancelled file picker (no file chosen) resolves `{ok: false}`, a parse error returns `{ok: false, error: <message>}`.
- Domain validation (unknown node types, version checks) is deliberately **not** done here — that's `fromVmbFile`'s job (Task 1). This module only gets bytes onto/off of disk and parses JSON.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/vmbIo.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openProject, saveProject, saveProjectAs } from '../src/persistence/vmbIo'
import type { VmbProjectFile } from '../src/ir/types'

const { openMock, saveMock, invokeMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  saveMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openMock, save: saveMock }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => (globalThis as { isTauri?: boolean }).isTauri === true,
}))

const FILE: VmbProjectFile = {
  version: 1,
  ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
  layout: { n1: { x: 0, y: 0 } },
}

afterEach(() => {
  ;(globalThis as { isTauri?: boolean }).isTauri = false
  openMock.mockReset()
  saveMock.mockReset()
  invokeMock.mockReset()
})

describe('saveProjectAs inside Tauri', () => {
  it('writes the file to the chosen path and returns it', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProjectAs(FILE)

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] }),
    )
    expect(invokeMock).toHaveBeenCalledWith('write_vmb_file', {
      path: '/home/user/pipeline.vmb',
      contents: JSON.stringify(FILE, null, 2),
    })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb' })
  })

  it('returns {ok: false} when the save dialog is cancelled', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue(null)

    const result = await saveProjectAs(FILE)

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false })
  })
})

describe('saveProject inside Tauri', () => {
  it('writes directly to an existing path without prompting', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProject(FILE, '/home/user/pipeline.vmb')

    expect(saveMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith('write_vmb_file', {
      path: '/home/user/pipeline.vmb',
      contents: JSON.stringify(FILE, null, 2),
    })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb' })
  })

  it('falls back to prompting (Save As) when there is no current path', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue('/home/user/new.vmb')
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProject(FILE, null)

    expect(saveMock).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, path: '/home/user/new.vmb' })
  })
})

describe('openProject inside Tauri', () => {
  it('reads and parses the chosen file', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockResolvedValue(JSON.stringify(FILE))

    const result = await openProject()

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] }),
    )
    expect(invokeMock).toHaveBeenCalledWith('read_vmb_file', { path: '/home/user/pipeline.vmb' })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb', raw: FILE })
  })

  it('returns {ok: false} when the open dialog is cancelled', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue(null)

    const result = await openProject()

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false })
  })

  it('returns an error result when the file contents are not valid JSON', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue('/home/user/broken.vmb')
    invokeMock.mockResolvedValue('not json{{{')

    const result = await openProject()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not valid json/i)
  })
})

describe('outside Tauri', () => {
  it('saveProjectAs triggers a browser download and reports success with no path', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const result = await saveProjectAs(FILE)

    expect(clickSpy).toHaveBeenCalled()
    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock')
    expect(result).toEqual({ ok: true, path: null })

    clickSpy.mockRestore()
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
  })

  it('saveProject always behaves like saveProjectAs (no path is ever remembered)', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const result = await saveProject(FILE, '/some/remembered/path.vmb')

    expect(clickSpy).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, path: null })

    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- vmbIo.test.ts`
Expected: FAIL — `../src/persistence/vmbIo` does not exist.

- [ ] **Step 3: Implement `apps/frontend/src/persistence/vmbIo.ts`**

```ts
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { VmbProjectFile } from '../ir/types'

const FILTERS = [{ name: 'TensorBuild Project', extensions: ['vmb'] }]

export type SaveOutcome = { ok: true; path: string | null } | { ok: false }
export type OpenOutcome = { ok: true; path: string | null; raw: unknown } | { ok: false; error?: string }

function downloadInBrowser(file: VmbProjectFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pipeline.vmb'
  anchor.click()
  URL.revokeObjectURL(url)
}

function pickFileInBrowser(): Promise<{ ok: true; raw: unknown } | { ok: false; error?: string }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.vmb'
    input.onchange = () => {
      const selected = input.files?.[0]
      if (!selected) {
        resolve({ ok: false })
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve({ ok: true, raw: JSON.parse(reader.result as string) })
        } catch {
          resolve({ ok: false, error: 'This file is not valid JSON.' })
        }
      }
      reader.onerror = () => resolve({ ok: false, error: 'Failed to read the selected file.' })
      reader.readAsText(selected)
    }
    // No 'cancel' event exists for <input type="file">, so a dialog dismissed
    // without picking a file simply never fires onchange and this promise
    // never resolves — an accepted limitation of the browser fallback path,
    // not a bug: Tauri's native dialogs (the primary path) resolve `null`
    // on cancel instead.
    input.click()
  })
}

export async function saveProjectAs(file: VmbProjectFile): Promise<SaveOutcome> {
  if (!isTauri()) {
    downloadInBrowser(file)
    return { ok: true, path: null }
  }
  const path = await save({ filters: FILTERS, defaultPath: 'pipeline.vmb' })
  if (typeof path !== 'string') {
    return { ok: false }
  }
  await invoke('write_vmb_file', { path, contents: JSON.stringify(file, null, 2) })
  return { ok: true, path }
}

export async function saveProject(file: VmbProjectFile, currentPath: string | null): Promise<SaveOutcome> {
  if (isTauri() && currentPath) {
    await invoke('write_vmb_file', { path: currentPath, contents: JSON.stringify(file, null, 2) })
    return { ok: true, path: currentPath }
  }
  return saveProjectAs(file)
}

export async function openProject(): Promise<OpenOutcome> {
  if (!isTauri()) {
    return pickFileInBrowser()
  }
  const path = await open({ multiple: false, filters: FILTERS })
  if (typeof path !== 'string') {
    return { ok: false }
  }
  const contents = await invoke<string>('read_vmb_file', { path })
  try {
    return { ok: true, path, raw: JSON.parse(contents) }
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- vmbIo.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `cd apps/frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/persistence/vmbIo.ts apps/frontend/tests/vmbIo.test.ts
git commit -m "feat: add Tauri/browser-fallback persistence I/O for .vmb files"
```

---

## Task 5: Unsaved-changes window-close guard (Tauri only)

**Files:**
- Create: `apps/frontend/src/persistence/useUnsavedChangesGuard.ts`
- Test: `apps/frontend/tests/useUnsavedChangesGuard.test.ts`

**Interfaces:**
- Consumes: `isTauri` (`@tauri-apps/api/core`); `getCurrentWindow` (`@tauri-apps/api/window`).
- Produces: `useUnsavedChangesGuard(isDirty: boolean): void` (`apps/frontend/src/persistence/useUnsavedChangesGuard.ts`) — used by Task 6/`App.tsx`.

**Design notes:** registers `onCloseRequested` once on mount (outside Tauri, this is a no-op — no listener is registered at all). The handler reads a ref (kept in sync with the `isDirty` prop via an effect) rather than closing over the prop directly, since the listener itself is registered only once.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/useUnsavedChangesGuard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedChangesGuard } from '../src/persistence/useUnsavedChangesGuard'

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>

const { onCloseRequestedMock } = vi.hoisted(() => ({ onCloseRequestedMock: vi.fn() }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: onCloseRequestedMock }),
}))

afterEach(() => {
  ;(globalThis as { isTauri?: boolean }).isTauri = false
  onCloseRequestedMock.mockReset()
  onCloseRequestedMock.mockResolvedValue(() => {})
  vi.restoreAllMocks()
})

describe('useUnsavedChangesGuard outside Tauri', () => {
  it('registers no close-requested listener', () => {
    renderHook(() => useUnsavedChangesGuard(true))

    expect(onCloseRequestedMock).not.toHaveBeenCalled()
  })
})

describe('useUnsavedChangesGuard inside Tauri', () => {
  it('registers a close-requested listener', () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true

    renderHook(() => useUnsavedChangesGuard(false))

    expect(onCloseRequestedMock).toHaveBeenCalled()
  })

  it('prevents closing when dirty and the user cancels the confirm', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    })
    rerender({ dirty: true })

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(window.confirm).toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalled()
  })

  it('allows closing when dirty and the user confirms', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    })
    rerender({ dirty: true })

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('allows closing without prompting when not dirty', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    const confirmSpy = vi.spyOn(window, 'confirm')
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    renderHook(() => useUnsavedChangesGuard(false))

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- useUnsavedChangesGuard.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `apps/frontend/src/persistence/useUnsavedChangesGuard.ts`**

```ts
import { isTauri } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'

export function useUnsavedChangesGuard(isDirty: boolean): void {
  const isDirtyRef = useRef(isDirty)

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined
    let cancelled = false

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow()
        .onCloseRequested((event) => {
          if (isDirtyRef.current && !window.confirm('You have unsaved changes. Close anyway?')) {
            event.preventDefault()
          }
        })
        .then((fn) => {
          if (cancelled) {
            fn()
          } else {
            unlisten = fn
          }
        })
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- useUnsavedChangesGuard.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `cd apps/frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/persistence/useUnsavedChangesGuard.ts apps/frontend/tests/useUnsavedChangesGuard.test.ts
git commit -m "feat: guard window close against unsaved changes (Tauri only)"
```

---

## Task 6: Wire Save/Save As/Open/New into App.tsx with dirty-state tracking

**Files:**
- Modify: `apps/frontend/src/App.tsx` (whole file restructured below)
- Modify: `apps/frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: `toVmbFile`, `fromVmbFile` (Task 1); `saveProject`, `saveProjectAs`, `openProject` (Task 4); `useUnsavedChangesGuard` (Task 5); existing `useNodes` (`apps/frontend/src/api/client.ts`).

- [ ] **Step 1: Update `apps/frontend/src/App.tsx`**

Replace the file's contents with (annotated diff below the full listing explains every change from the current file):

```tsx
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useEdgesState, useNodesState, type OnEdgesChange, type OnNodesChange } from '@xyflow/react'
import { useGetCode, useNodes, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { fromVmbFile, toIR, toVmbFile } from './ir/convert'
import { AppLayout } from './layout/AppLayout'
import { NodePalette } from './palette/NodePalette'
import { OutputPanel, type OutputTab } from './output/OutputPanel'
import { openProject, saveProject, saveProjectAs } from './persistence/vmbIo'
import { useUnsavedChangesGuard } from './persistence/useUnsavedChangesGuard'
import { usePreview } from './preview/usePreview'
import { nodeStatusesFromTrainingState } from './training/nodeStatuses'
import { useTrainingRun } from './training/useTrainingRun'
import { VisualizationsPanel } from './visualizations/VisualizationsPanel'

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<PipelineEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isCodeViewOpen, setCodeViewOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [outputTab, setOutputTab] = useState<OutputTab>('results')
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const preview = usePreview()
  const trainingState = useTrainingRun(activeRunId)
  const { data: manifests } = useNodes()

  const runMutation = useRunPipeline()
  const codeMutation = useGetCode()

  useUnsavedChangesGuard(isDirty)

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const nodeLabels = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node.data.manifest.label])),
    [nodes],
  )

  const setNodesTracked = useCallback<Dispatch<SetStateAction<PipelineNode[]>>>(
    (update) => {
      setIsDirty(true)
      setNodes(update)
    },
    [setNodes],
  )

  const setEdgesTracked = useCallback<Dispatch<SetStateAction<PipelineEdge[]>>>(
    (update) => {
      setIsDirty(true)
      setEdges(update)
    },
    [setEdges],
  )

  const handleNodesChange = useCallback<OnNodesChange<PipelineNode>>(
    (changes) => {
      setIsDirty(true)
      onNodesChange(changes)
    },
    [onNodesChange],
  )

  const handleEdgesChange = useCallback<OnEdgesChange<PipelineEdge>>(
    (changes) => {
      setIsDirty(true)
      onEdgesChange(changes)
    },
    [onEdgesChange],
  )

  const handleParamChange = useCallback(
    (nodeId: string, paramName: string, value: unknown) => {
      setIsDirty(true)
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
    setActiveRunId(null)
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

  const handleNew = useCallback(() => {
    if (isDirty && !window.confirm('New project? This clears all nodes and results.')) return

    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
    setCodeViewOpen(false)
    setActiveRunId(null)
    setOutputTab('results')
    preview.reset()
    runMutation.reset()
    codeMutation.reset()
    setCurrentFilePath(null)
    setProjectError(null)
    setIsDirty(false)
  }, [isDirty, setNodes, setEdges, preview, runMutation, codeMutation])

  const handleSave = useCallback(async () => {
    const result = await saveProject(toVmbFile(nodes, edges), currentFilePath)
    if (!result.ok) return
    if (result.path) setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [nodes, edges, currentFilePath])

  const handleSaveAs = useCallback(async () => {
    const result = await saveProjectAs(toVmbFile(nodes, edges))
    if (!result.ok) return
    if (result.path) setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [nodes, edges])

  const handleOpen = useCallback(async () => {
    if (isDirty && !window.confirm('You have unsaved changes. Open a different project anyway?')) return

    const result = await openProject()
    if (!result.ok) {
      if (result.error) setProjectError(result.error)
      return
    }

    const converted = fromVmbFile(result.raw, manifests ?? [])
    if (!converted.ok) {
      setProjectError(converted.error)
      return
    }

    setNodes(converted.nodes)
    setEdges(converted.edges)
    setSelectedNodeId(null)
    setCodeViewOpen(false)
    setActiveRunId(null)
    setOutputTab('results')
    preview.reset()
    runMutation.reset()
    codeMutation.reset()
    setCurrentFilePath(result.path)
    setProjectError(null)
    setIsDirty(false)
  }, [isDirty, manifests, setNodes, setEdges, preview, runMutation, codeMutation])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setOutputTab('preview')
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const nodeStatuses = useMemo(() => {
    if (activeRunId) return nodeStatusesFromTrainingState(trainingState)
    if (runMutation.isPending) {
      return Object.fromEntries(nodes.map((node) => [node.id, 'running' as const]))
    }
    return {}
  }, [activeRunId, trainingState, runMutation.isPending, nodes])

  const isRunning =
    runMutation.isPending ||
    (activeRunId !== null && (trainingState.status === 'connecting' || trainingState.status === 'running'))

  const resultMetrics =
    runMutation.data?.kind === 'sync'
      ? runMutation.data.metrics
      : trainingState.status === 'complete'
        ? trainingState.metrics
        : undefined

  const runError =
    runMutation.error?.message ??
    (activeRunId && trainingState.status === 'error' ? trainingState.error : null)

  const projectName = currentFilePath ? currentFilePath.split(/[/\\]/).pop() : 'Untitled'

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>TensorBuild</h1>
        <span className="project-name">
          {isDirty ? '• ' : ''}
          {projectName}
        </span>
        <button type="button" onClick={handleNew} disabled={isRunning}>
          New
        </button>
        <button type="button" onClick={handleOpen} disabled={isRunning}>
          Open
        </button>
        <button type="button" onClick={handleSave} disabled={isRunning}>
          Save
        </button>
        <button type="button" onClick={handleSaveAs} disabled={isRunning}>
          Save As
        </button>
        <button type="button" className={isRunning ? 'is-running' : undefined} onClick={handleRun} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      {projectError && <p className="error-banner">{projectError}</p>}
      {codeMutation.error && <p className="error-banner">{codeMutation.error.message}</p>}

      <AppLayout
        palette={<NodePalette />}
        canvas={
          <PipelineCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            setNodes={setNodesTracked}
            setEdges={setEdgesTracked}
            onSelectNode={setSelectedNodeId}
            nodeStatuses={nodeStatuses}
          />
        }
        inspector={
          <InspectorPanel
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onParamChange={handleParamChange}
            onPreview={handlePreview}
          />
        }
        output={
          <OutputPanel
            activeTab={outputTab}
            onTabChange={setOutputTab}
            runMetrics={resultMetrics}
            runError={runError}
            previewState={preview.state}
            nodeLabels={nodeLabels}
          />
        }
        visualizations={
          <VisualizationsPanel
            runMetrics={resultMetrics}
            previewData={preview.state.status === 'success' ? preview.state.data : undefined}
            trainingState={activeRunId ? trainingState : undefined}
            nodeLabels={nodeLabels}
          />
        }
      />

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
    </div>
  )
}
```

Summary of what changed from the current file:
- New imports: `useEffect`, `type Dispatch`, `type SetStateAction` from `react`; `type OnEdgesChange, type OnNodesChange` from `@xyflow/react`; `useNodes` added to the existing `./api/client` import; `fromVmbFile, toVmbFile` added to the existing `./ir/convert` import; `openProject, saveProject, saveProjectAs` from the new `./persistence/vmbIo`; `useUnsavedChangesGuard` from the new `./persistence/useUnsavedChangesGuard`.
- New state: `currentFilePath`, `isDirty`, `projectError`.
- New: `useUnsavedChangesGuard(isDirty)` call; `setNodesTracked`/`setEdgesTracked` wrapping `setNodes`/`setEdges`; `handleNodesChange`/`handleEdgesChange` wrapping `onNodesChange`/`onEdgesChange` — all four mark `isDirty` before delegating.
- `handleParamChange` gains one line: `setIsDirty(true)` at the top.
- `handleReset` is renamed `handleNew`, gains the `isDirty &&`-guarded confirm (was unconditional), and additionally clears `currentFilePath`/`projectError`/`isDirty`.
- New: `handleSave`, `handleSaveAs`, `handleOpen`, and a `keydown` effect for Cmd/Ctrl+S.
- `PipelineCanvas` now receives `onNodesChange={handleNodesChange}`, `onEdgesChange={handleEdgesChange}`, `setNodes={setNodesTracked}`, `setEdges={setEdgesTracked}` instead of the raw hook values.
- Header: added the project-name/dirty-indicator `<span>` and New/Open/Save/Save As buttons; "Reset" button removed (replaced by "New"); button order changed (New/Open/Save/Save As now precede Run/View Code) — this reorder is why several `App.test.tsx` assertions below don't need position-based changes: all lookups are by accessible name, not order.
- Added `{projectError && <p className="error-banner">{projectError}</p>}` alongside the existing codegen error banner.

- [ ] **Step 2: Update `apps/frontend/tests/App.test.tsx`**

Two existing tests reference the old "Reset" button and its unconditional confirm; both must change because "New" only confirms when the canvas is dirty. Replace:

```tsx
  it('does nothing when the reset confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const runMutate = vi.fn()
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate, reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }))

    expect(window.confirm).toHaveBeenCalledWith('Reset the canvas? This clears all nodes and results.')
    expect(runReset).not.toHaveBeenCalled()
    expect(codeReset).not.toHaveBeenCalled()
  })

  it('clears run/code mutation state and returns to the Results tab after the reset is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))
    expect(await screen.findByRole('tab', { name: /data preview/i })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }))

    expect(runReset).toHaveBeenCalled()
    expect(codeReset).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /^results$/i })).toHaveAttribute('aria-selected', 'true')
  })
```

with:

```tsx
  it('clicking New does nothing else and does not prompt when the canvas is clean', async () => {
    const runMutate = vi.fn()
    const runReset = vi.fn()
    const codeReset = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm')
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate, reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(runReset).toHaveBeenCalled()
    expect(codeReset).toHaveBeenCalled()
  })

  it('New prompts for confirmation once the canvas is dirty, and does nothing if cancelled', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(window.confirm).toHaveBeenCalledWith('New project? This clears all nodes and results.')
    expect(runReset).not.toHaveBeenCalled()
    expect(codeReset).not.toHaveBeenCalled()
  })

  it('clears run/code mutation state and returns to the Results tab after New is confirmed on a dirty canvas', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const runReset = vi.fn()
    const codeReset = vi.fn()
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ reset: runReset }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({ reset: codeReset }))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))
    expect(await screen.findByRole('tab', { name: /data preview/i })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    expect(runReset).toHaveBeenCalled()
    expect(codeReset).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /^results$/i })).toHaveAttribute('aria-selected', 'true')
  })
```

Then, still in `apps/frontend/tests/App.test.tsx`, add a new mock for the persistence module and new describe blocks. Add near the top, alongside the existing `vi.mock('../src/api/client', ...)` block:

```tsx
const { saveProjectMock, saveProjectAsMock, openProjectMock } = vi.hoisted(() => ({
  saveProjectMock: vi.fn(),
  saveProjectAsMock: vi.fn(),
  openProjectMock: vi.fn(),
}))

vi.mock('../src/persistence/vmbIo', () => ({
  saveProject: saveProjectMock,
  saveProjectAs: saveProjectAsMock,
  openProject: openProjectMock,
}))

vi.mock('../src/persistence/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: vi.fn(),
}))
```

And add these tests at the end of the top-level `describe('App', ...)` block, before its closing `})`:

```tsx
  it('saves to the remembered path on Save, and shows the filename once one exists', async () => {
    saveProjectMock.mockResolvedValue({ ok: true, path: '/home/user/pipeline.vmb' })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(saveProjectMock).toHaveBeenCalledWith(
      { version: 1, ir: { nodes: [], edges: [] }, layout: {} },
      null,
    )
    expect(await screen.findByText('pipeline.vmb')).toBeInTheDocument()
  })

  it('Save As always prompts, even when a current path is already set', async () => {
    saveProjectMock.mockResolvedValue({ ok: true, path: '/home/user/pipeline.vmb' })
    saveProjectAsMock.mockResolvedValue({ ok: true, path: '/home/user/renamed.vmb' })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByText('pipeline.vmb')
    await userEvent.click(screen.getByRole('button', { name: /^save as$/i }))

    expect(saveProjectAsMock).toHaveBeenCalled()
    expect(await screen.findByText('renamed.vmb')).toBeInTheDocument()
  })

  it('loads nodes/edges from Open and shows the opened filename', async () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [
        {
          id: 'data.csv_loader',
          category: 'Data',
          label: 'CSV Loader',
          inputs: [],
          outputs: [{ name: 'table', type: 'Table' }],
          params: [],
          long_running: false,
        },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    openProjectMock.mockResolvedValue({
      ok: true,
      path: '/home/user/loaded.vmb',
      raw: {
        version: 1,
        ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
        layout: { n1: { x: 5, y: 5 } },
      },
    })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(await screen.findByText('loaded.vmb')).toBeInTheDocument()
  })

  it('shows an error banner and leaves the canvas unchanged when Open fails validation', async () => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)
    openProjectMock.mockResolvedValue({
      ok: true,
      path: '/home/user/broken.vmb',
      raw: { version: 1, ir: { nodes: [{ id: 'n1', type: 'unknown.node', params: {} }], edges: [] }, layout: {} },
    })
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(await screen.findByText('Unknown node types: unknown.node')).toBeInTheDocument()
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('Open confirms before discarding a dirty canvas, and does nothing if cancelled', async () => {
    stubNodeFlag.shouldInject = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^open$/i }))

    expect(window.confirm).toHaveBeenCalledWith('You have unsaved changes. Open a different project anyway?')
    expect(openProjectMock).not.toHaveBeenCalled()
  })
```

Also reset the new mocks in the existing top-level `afterEach`:

```tsx
  afterEach(() => {
    stubNodeFlag.shouldInject = false
    saveProjectMock.mockReset()
    saveProjectAsMock.mockReset()
    openProjectMock.mockReset()
  })
```

- [ ] **Step 3: Run the frontend test suite**

Run: `cd apps/frontend && npm test`
Expected: PASS — every test in `App.test.tsx` and every other existing test file (this task doesn't touch any other component's behavior, only `App.tsx`'s own props/state)

- [ ] **Step 4: Type-check and build**

Run: `cd apps/frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/tests/App.test.tsx
git commit -m "feat: wire Save/Save As/Open/New with dirty-state tracking into App"
```

---

## Manual QA (after all tasks land)

Automated tests cover the conversion logic, the I/O module's branching, and App's orchestration — but native OS dialogs, actual disk I/O, and the window-close interception can only be verified against the real Tauri shell:

- [ ] `cd apps/shell/src-tauri && cargo tauri dev` — drag a few different node types onto the canvas, connect some edges, set non-default params.
- [ ] Click **Save As**, save to a path *outside* the repo (e.g. your home directory) — confirm no error, and the header shows the filename with no dirty dot.
- [ ] Make an edit (move a node, change a param) — confirm the dirty dot (`•`) reappears.
- [ ] Click **Save** — confirm it writes silently (no dialog) and the dirty dot clears.
- [ ] Press **Cmd/Ctrl+S** — confirm it behaves the same as clicking Save.
- [ ] Click **New** with a clean canvas — confirm no confirmation prompt.
- [ ] Make an edit, click **New**, cancel the confirmation — confirm the canvas is unchanged.
- [ ] Make an edit, click **New**, confirm — confirm the canvas clears and the header returns to "Untitled".
- [ ] Click **Open**, pick the file saved earlier — confirm nodes/edges/positions/params are restored exactly, and the header shows its filename.
- [ ] Hand-edit a saved `.vmb` file's `ir.nodes[0].type` to a nonexistent node type, click **Open**, pick it — confirm a clear error banner naming the missing type, and the canvas is left as it was before the Open attempt.
- [ ] Make an edit, then close the window (the OS close button) — confirm a native confirm prompt appears; cancelling keeps the app open, confirming closes it.
- [ ] With a clean canvas, close the window — confirm it closes with no prompt.
- [ ] Stop `cargo tauri dev`, run `cd apps/frontend && npm run dev` standalone (no Tauri shell) — confirm Save triggers a browser download of `pipeline.vmb`, and Open (choosing that downloaded file) restores the canvas.
