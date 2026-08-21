# Visual Model Builder — Frontend (Canvas Slice) Design Spec

**Date:** 2026-08-21
**Status:** Approved for implementation
**Parent spec:** `docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md`

## Overview

The first frontend milestone: a React app that renders the pipeline canvas
(palette, React Flow graph, inspector, generated-code view) and drives the
already-built Python engine (`engine/vmb_engine`, plan:
`docs/superpowers/plans/2026-08-20-python-engine-core.md`) over its HTTP API.
This is the first "out of scope" item named at the end of the engine-core
plan: "Tauri shell + React frontend (separate plan; consumes this API)."

This plan builds only the React app, run against a manually-started engine
dev server (`uvicorn vmb_engine.api:app`). It proves the frontend can build a
pipeline, run it, and view generated code against the real engine — the
frontend's equivalent of what the engine-core plan proved end-to-end for the
IR/executor/codegen triangle.

## Goals

- A working canvas: drag nodes from a palette (populated from `GET /nodes`),
  connect them with type-checked edges, edit params in an inspector panel
  rendered generically from each node's manifest schema.
- "Run" executes the current graph via `POST /pipeline/run` and displays the
  returned metrics.
- "View Code" fetches the generated script via `POST /pipeline/codegen` and
  displays it, syntax-highlighted, read-only.
- Runs against the engine's 4 existing nodes (`data.csv_loader`,
  `data.train_test_split`, `sklearn_models.random_forest`,
  `evaluation.evaluate_classifier`) without any frontend code assuming those
  specific types — the palette and inspector are schema-driven, per the
  parent spec's plugin-system principle.

## Non-goals (this slice)

- Tauri desktop shell — no sidecar process spawning, no packaging. The app
  runs as a browser page pointed at a manually-started engine
  (`http://127.0.0.1:8000`). Tauri integration is a separate follow-up plan.
- WebSocket training monitor / live progress — the engine has no
  `long_running` nodes yet (no PyTorch training nodes exist), so there is
  nothing to stream. Deferred to the plan that adds PyTorch training nodes.
- Project save/load (`.vmb` files) — deferred to its own follow-up plan.
- Undo/redo, multi-select, subflows, minimap customization — no requirement
  driving them yet; React Flow's defaults are used as-is.
- E2E/browser automation testing — acceptance for this slice is unit tests
  plus manual verification against a running engine dev server.

## Architecture

```
apps/frontend/
  package.json         # Vite + React + TypeScript
  src/
    api/                # typed fetch wrappers + TanStack Query hooks
      client.ts          # getNodes(), runPipeline(ir), getCode(ir)
      types.ts            # NodeManifest, ParamSpec, Port, PipelineIR (TS mirrors of engine's pydantic models)
    canvas/
      PipelineCanvas.tsx  # React Flow wrapper, custom node renderer
      validation.ts        # isValidConnection: port-type compatibility check
    palette/
      NodePalette.tsx      # categorized list from getNodes(), drag-to-add
    inspector/
      InspectorPanel.tsx    # selected node's params, dispatched by ParamSpec.type
      params/                # one small component per param type (Text/Number/Select/FilePicker/Checkbox/Slider)
    codeview/
      CodeViewPanel.tsx      # "View Code" panel, syntax-highlighted, read-only
    ir/
      convert.ts              # toIR(nodes, edges) -> PipelineIR; the only place
                               # React Flow's shape meets the engine's IR shape
    App.tsx                   # layout: palette | canvas | inspector, Run + View Code buttons, error banners
  tests/
    convert.test.ts           # toIR round-trip / shape tests
    validation.test.ts         # port-type accept/reject cases
    InspectorPanel.test.tsx     # one case per param type
```

**Key principle (inherited from the parent spec):** the React Flow graph
*is* the working state for this slice — its `nodes`/`edges` arrays are
controlled state whose shape (`id`, `type`, `data.params`) already tracks the
engine's `NodeSpec`/`EdgeSpec` closely. `ir/convert.ts` converts to
`PipelineIR` JSON only at the two points that need it: the `/pipeline/run`
and `/pipeline/codegen` request bodies. No separate canonical store (e.g.
Zustand) is introduced in this slice — React Flow's own state is the single
source of truth for canvas structure, and node positions (display-only, not
part of the wire-format IR) live in the same `nodes` array without needing
separate tracking. This should be revisited if a later slice (project
save/load, undo/redo) needs multi-view synchronization that React Flow's
own state can't provide directly.

No Tauri shell exists yet, so there is no local-IPC auth token to plumb
through in this slice — the app talks to `http://127.0.0.1:8000` directly
with no auth. The `api/client.ts` module's base URL is the one seam a future
Tauri plan will need to change (token header, dynamic port from the shell).

## Data Flow

1. **Load palette:** `App` mounts, `useNodes()` (TanStack Query) calls
   `GET /nodes`, caches the manifest list. `NodePalette` groups the result by
   `category`.
2. **Add a node:** dragging a palette entry onto the canvas calls React
   Flow's `addNodes` with a generated id (`n${counter}`, counter is
   component state), `type` = the manifest's `id`, and
   `data = { manifest, params: defaultsFromManifest(manifest.params) }`
   (defaults pulled from each `ParamSpec.default`).
3. **Edit params:** selecting a node renders `InspectorPanel` from
   `node.data.manifest.params`, dispatching one param sub-component per
   `ParamSpec.type` (`text`, `number`, `select`, `file_picker`, `checkbox`,
   `slider`). `onChange` updates `node.data.params` via React Flow's
   `setNodes`.
4. **Connect nodes:** React Flow's `isValidConnection` (wired to
   `canvas/validation.ts`) looks up the source node's output port type and
   the target node's input port type from their manifests and rejects the
   connection before it's added if the types don't match.
5. **Run:** `convert.toIR(nodes, edges)` builds the `PipelineIR` JSON
   (`nodes: [{id, type, params}]`, `edges: [{from: "n1.table", to: "n2.table"}]`
   — positions/UI state are dropped, not part of the wire format). POSTed to
   `/pipeline/run` via a `useMutation`. On success, render the returned
   `{metrics: {"<node_id>.<port>": value}}` as a simple list — no charts,
   that's the training-monitor's job later. On 422, show the engine's
   `detail` string near the Run button.
6. **View Code:** same `convert.toIR()`, POSTed to `/pipeline/codegen`.
   Success opens `CodeViewPanel` with the returned `code` string, syntax
   highlighted (a lightweight highlighter component, not a full editor —
   read-only). 422s show inline the same way as Run.

## Error Handling

- Engine unreachable (dev server not running, or wrong port): `useNodes()`'s
  query error state renders a banner in place of the palette — "Can't reach
  engine at http://127.0.0.1:8000 — is it running?" — rather than a blank or
  silently-stuck palette.
- `/pipeline/run` / `/pipeline/codegen` 422 (the engine's `ExecutorError`/
  `RegistryError` responses): the mutation's error state renders the
  engine's `detail` string inline near the triggering button. No toast
  system introduced for this slice — inline is sufficient for two buttons.
- Invalid connections are prevented at drop time (`isValidConnection`
  returns `false`); there is nothing to recover from after the fact, so no
  separate error surface for this case.

## Testing Strategy

- **`ir/convert.ts`**: unit tests covering node/edge shape conversion,
  including that node positions are dropped and that param values round-trip
  unchanged. This is the frontend's analog to the engine's IR round-trip
  tests — the one function every other piece depends on being correct.
- **`canvas/validation.ts`**: unit tests for `isValidConnection` — matching
  port types accepted, mismatched types rejected, self-loops rejected.
- **`inspector/InspectorPanel`**: one rendering/interaction test per
  `ParamSpec.type` (all 6), verifying the right control renders and
  `onChange` fires with the right shape.
- **No E2E/browser automation** in this slice. Acceptance is the unit suite
  passing plus a manual pass: start the engine dev server, start the Vite
  dev server, build a `csv_loader → train_test_split → random_forest →
  evaluate_classifier` pipeline on the canvas, Run it, view the generated
  code, confirm both work against the real engine.

## Tech Stack

- Vite + React + TypeScript (matches the parent spec's `apps/frontend/`
  layout).
- React Flow for the canvas.
- TanStack Query for `GET /nodes`, `POST /pipeline/run`,
  `POST /pipeline/codegen` (caching/loading/error state without hand-rolled
  fetch plumbing — useful now and even more so once the WebSocket
  training-monitor plan adds more request traffic).
- A lightweight syntax highlighter (e.g. `react-syntax-highlighter`) for the
  code view — not a full editor (Monaco, CodeMirror), since the view is
  read-only.
- Vitest + React Testing Library for unit tests.

## Future Work (explicitly out of scope for this plan)

- Tauri shell: sidecar process spawning, per-session auth token, dynamic
  port discovery, `.dmg`/`.msi` packaging.
- WebSocket training monitor: live loss/accuracy charts, `long_running` node
  progress events — blocked on the PyTorch training-node plan existing.
- Project save/load (`.vmb` files).
- `~/.vmb/plugins` discovery surfaced in the palette (engine-side wiring is
  itself deferred per the engine-core plan).
