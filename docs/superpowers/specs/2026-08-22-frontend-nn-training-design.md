# Frontend Support for NN Training — Design

## Overview

The `engine/` side of PyTorch NN training (five `pytorch_models` nodes —
`Input`, `Linear`, `ReLU`, `Dropout`, `Train` — plus async execution and a
`GET /ws/runs/{run_id}` progress WebSocket for `long_running` nodes) is done
and merged (see `docs/superpowers/specs/2026-08-21-nn-training-core-design.md`).
Nothing on the frontend consumes it yet. This spec covers the frontend
milestone that closes that gap: rendering the new nodes and handling the
async run + live training-progress flow.

## Current state (context, not new work)

Node rendering in this frontend is entirely manifest-driven — the palette
(`NodePalette.tsx`), canvas node shape and ports (`PipelineCanvas.tsx`), and
param inspector (`InspectorPanel.tsx` + `inspector/params/*`) all iterate
`NodeManifest.inputs`/`outputs`/`params` generically, with no per-node-type
branching anywhere. All five `pytorch_models` param types (`text`, `number`,
`select`, `checkbox`, `slider`) already have inspector components. As a
result, the five new nodes already drag onto the canvas, connect via typed
ports, and expose editable params today, with zero frontend changes.

The actual gap — and a live bug today — is that `runPipeline`
(`api/client.ts`) assumes every `/pipeline/run` response is a synchronous
`200 {metrics}`. A pipeline containing `pytorch_models.train` gets a
`202 {run_id}` instead; the current code silently mis-parses that as a
`RunResult`, and `App.tsx`'s `Object.entries(runMutation.data.metrics)`
throws on the missing `metrics` field. This is the change that actually
unblocks running any PyTorch pipeline from the UI.

## Goals

- Handle the `202 {run_id}` response from `POST /pipeline/run` without
  breaking the existing synchronous flow for sklearn-only pipelines.
- Open `WS /ws/runs/{run_id}` and render live training progress: a
  loss/val_loss-vs-epoch line chart that updates as `progress` events
  arrive.
- Surface `node_error` and `complete` terminal events appropriately (error
  banner vs. final metrics).
- Give the `Layer` port type its own edge/handle color, per the accepted
  nn-training-core spec's Frontend section.

## Non-Goals

- WS reconnect/replay of missed events on client disconnect — the engine
  doesn't support this either (documented limitation, acceptable for
  seconds-to-low-minutes training runs).
- Cancelling an in-progress run from the UI — no engine endpoint for it
  today.
- Any change to node execution/codegen semantics — this is frontend-only.

## New dependency

`recharts` (React-idiomatic line chart components; simple two-series
line chart, actively maintained, works with React 19) — added to
`apps/frontend/package.json`.

## Architecture

### 1. Async run handling (`api/client.ts`, `api/types.ts`)

`runPipeline`'s return type becomes a discriminated union:

```ts
export type RunOutcome =
  | { kind: 'sync'; metrics: Record<string, unknown> }
  | { kind: 'async'; runId: string }
```

The `/pipeline/run` POST helper checks `response.status`: `202` maps to
`{kind: 'async', runId: body.run_id}`; anything else `2xx` maps to
`{kind: 'sync', metrics: body.metrics}` (unchanged from today, just
relabeled). `/pipeline/codegen` is untouched — always synchronous, its own
`CodegenResult` return type stays as-is. `useRunPipeline()` stays a
`useMutation`, now typed `RunOutcome`.

### 2. WebSocket hook (`training/useTrainingRun.ts`)

```ts
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

export function useTrainingRun(runId: string | null): TrainingState
```

`useTrainingRun` opens `new WebSocket(wsUrl)` (the existing HTTP `baseUrl`
with its scheme swapped `http(s)` → `ws(s)`) in an effect keyed on `runId`,
transitioning `connecting` → `running` on the socket's `open` event. Each
`message` is parsed as JSON and handled by its `event` field:

- `progress` → appended to `history`, status stays `running`.
- `complete` → status becomes `complete`, socket closed, no further
  messages processed.
- `node_error` → status becomes `error` (message = event's `error` field),
  socket closed.

The effect's cleanup closes the socket on unmount or on `runId` changing to
`null`/a new value. No reconnect logic (matches the engine's documented
no-replay behavior — see Non-Goals).

### 3. Training monitor UI (`training/TrainingMonitor.tsx`)

A full-screen modal, structurally consistent with the existing
`CodeViewPanel` (`position: fixed; inset: 0`), rendered whenever there's an
active `runId`:

```ts
<TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />
```

Internally calls `useTrainingRun(runId)` and renders by `status`:

- `connecting` / `running`: header "Training…", a Recharts `<LineChart>`
  plotting `loss` and `val_loss` against `epoch` from `history` (updates
  live as new points arrive).
- `complete`: header "Training complete", the same chart (final state) plus
  the final `metrics` rendered below it reusing the existing
  `.metrics-list` styling/markup.
- `error`: header "Training failed", the error rendered via the existing
  `.error-banner` style; partial chart history (if any) stays visible above
  it.

A close (×) button is always available (mirrors `CodeViewPanel`'s and the
canvas node's existing delete-button pattern) and calls `onClose`, which
unmounts the monitor and, via the hook's cleanup, closes the socket. This
is safe mid-run: the engine tolerates client disconnects and keeps training
to completion server-side (Non-Goals) — the run just stops being observed.

### 4. Wiring in `App.tsx`

New state: `const [activeRunId, setActiveRunId] = useState<string | null>(null)`.

`handleRun`'s mutation success handler branches on `RunOutcome.kind`:
- `'sync'`: unchanged — the existing metrics list renders from
  `runMutation.data`.
- `'async'`: `setActiveRunId(outcome.runId)`, which mounts
  `<TrainingMonitor>`. The existing `runMutation.data`/error rendering
  block is guarded to only show for `kind === 'sync'` results.

### 5. Layer-port edge/handle color

A small, self-contained addition in `canvas/`:

```ts
const PORT_TYPE_COLORS: Record<string, string> = {
  Table: '#4a90d9',
  Layer: '#9b59b6',
  Model: '#2ecc71',
  Metrics: '#e67e22',
}
```

- `TargetPort`/`SourcePort` (`PipelineCanvas.tsx`) use this map to color
  the `Handle` dot by `port.type` (fallback to the current default gray for
  any unmapped type, so this degrades gracefully for future port types).
- `handleConnect` looks up the source port's type (via the manifest of the
  connection's source node) and stashes it as `edge.data = { portType }`;
  `DeleteableEdge` reads `data.portType` through the same map to set the
  edge `stroke` color (fallback to the current default otherwise).

No other node-type-specific branching is introduced — this is purely a
type→color lookup, not special-casing `pytorch_models` nodes.

## Data Flow

```
User clicks "Run"
  → toIR(nodes, edges) → POST /pipeline/run
  → 200 {metrics}              → kind: 'sync'  → existing metrics-list UI
  → 202 {run_id}                → kind: 'async' → setActiveRunId(run_id)
                                                  → <TrainingMonitor> mounts
                                                  → useTrainingRun opens WS /ws/runs/{run_id}
                                                  → progress* → chart updates live
                                                  → complete  → final metrics shown
                                                  → node_error → error banner shown
```

## Error Handling

- `POST /pipeline/run` returning a non-2xx (422 validation error) is
  unchanged — surfaces via the existing `runMutation.error` → `.error-banner`
  path, same as today. This applies equally to pipelines with or without a
  `long_running` node, since the 422 case happens before any run starts.
- A WebSocket `error`/unexpected `close` event (network failure, not a
  `node_error` message) is treated as a terminal `error` state with a
  generic "connection lost" message, so the monitor never hangs silently.
- A `node_error` event is a normal terminal state, not a JS exception —
  rendered the same way as an HTTP 422 (via `.error-banner`) for visual
  consistency.

## Testing Strategy

Following the existing flat `apps/frontend/tests/` convention (one test
file per source module):

- `client.test.ts`: extend for `runPipeline`'s 200-vs-202 branching
  (mocked `fetch` returning each status; assert the resulting `RunOutcome`
  shape).
- `useTrainingRun.test.ts`: mock the global `WebSocket`, drive it through
  `open` → several `progress` messages → `complete`, and separately →
  `node_error`, and separately an unexpected `close`; assert `TrainingState`
  transitions and accumulated `history` at each step.
- `TrainingMonitor.test.tsx`: renders each terminal/non-terminal state
  (mocking `useTrainingRun`'s return value) and asserts the right UI
  (chart present, metrics list on complete, error banner on error).
- `App.integration.test.tsx`: extend so a pipeline containing
  `pytorch_models.train` triggers the `202` branch and mounts
  `TrainingMonitor` (mocking `fetch` and `WebSocket` at this level too).
- `PipelineCanvas.test.tsx`: extend for the port/edge color lookup (handle
  and edge get the expected color for a known port type; unmapped type
  falls back to the default).

## Tech Stack

No changes beyond the new `recharts` dependency — same React 19 + Vite +
TypeScript + `@tanstack/react-query` + `@xyflow/react` stack as the rest of
the frontend.

## Future Work (explicitly out of scope for this spec)

- Run cancellation from the UI.
- WS reconnect/replay for dropped connections mid-run.
- Persisting/comparing training runs across sessions (run history).
