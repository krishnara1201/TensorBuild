# Pipeline Data Preview & Metrics Visualization — Design

## Overview

Two related gaps in the frontend today:

1. There is no way to see the actual data flowing through a pipeline. A
   `Table`-typed output (e.g. `data/csv_loader`, `preprocessing/clean_data`)
   exists only as a live pandas DataFrame inside the executor's in-memory
   context — never serialized, never shown to the user. Params like
   `target_column` are free-text fields the user has to fill in blind,
   without knowing what columns actually exist upstream.
2. `Metrics` outputs, which the engine does return today, are rendered as
   raw `JSON.stringify` — `n22.metrics{"accuracy": 0.91}` as a literal
   string in a list item — including `confusion_matrix`, which comes back
   as a nested list and is shown as an unreadable JSON blob instead of a
   grid.

This spec adds: a new engine endpoint that executes a bounded subgraph and
serializes a `Table`'s columns/sample rows on demand; a manifest-schema
addition so a `select` param can source its options from that endpoint
instead of a static list; a frontend side panel for browsing a node's
output; and a proper formatted view for `Metrics` (a real confusion-matrix
grid, formatted scalars, and a safe fallback for anything else).

## Goals

- Let the user preview a data-producing node's output (columns, dtypes, a
  row sample, total row count) from a button in the Inspector, without
  needing to run the whole pipeline first.
- Turn `target_column`-style params into dropdowns populated from the
  actual upstream columns, auto-loaded when the node is selected and its
  input is connected.
- Replace raw-JSON metrics rendering with: formatted scalars, a real
  confusion-matrix grid (rows/columns labeled, diagonal highlighted), and
  a readable fallback for unrecognized shapes.
- Reuse the existing executor/topological-sort machinery for the new
  partial-execution path, rather than building a second, parallel
  execution mechanism.

## Non-Goals

- Previewing anything other than `Table` outputs. `ImageBatch`/`Layer`/
  `Model` outputs are not previewable in this pass — there's no
  established way to render an image grid or a layer stack usefully yet,
  and no current request for it.
- Editing data from the preview panel. It's read-only.
- Pagination beyond the fixed sample (see below) — no "next page" UI.
- Live/streaming preview updates as the user edits upstream params without
  re-clicking Preview. The user re-triggers preview explicitly (button) or
  it re-triggers on node reselection (dropdown); it does not watch for
  keystroke-level param edits.
- A general "run any subgraph" feature exposed anywhere in the UI beyond
  these two specific uses (preview panel, dropdown options) — the new
  endpoint is scoped to Table-output preview, not a general partial-run
  tool.
- Charting/visualizing metrics beyond the confusion-matrix grid (e.g. a
  ROC curve, a loss-vs-epoch static chart for a synchronous run) — the
  live loss chart during training already exists (`TrainingMonitor`);
  this spec is about post-hoc `Metrics` display, not adding new metric
  computations.

## Engine: `POST /pipeline/preview`

**Request:**
```json
{
  "pipeline": { "nodes": [...], "edges": [...] },
  "target_node_id": "n3",
  "port": "train"
}
```
Same `PipelineIR` shape already sent to `/pipeline/run` and
`/pipeline/codegen`.

**Response (200):**
```json
{
  "columns": [
    {"name": "age", "dtype": "int64"},
    {"name": "label", "dtype": "object"}
  ],
  "rows": [[25, "yes"], [31, "no"]],
  "total_rows": 4200
}
```
`rows` is capped at 50 sample rows (`df.head(50)`) regardless of
`total_rows` — this is a preview, not a data browser (Non-Goals).
`dtype` is `str(series.dtype)`.

**Error responses (422), matching the existing `ExecutorError` → 422
convention in `api.py`:**
- `{"error": "cannot preview past a training node"}` — the ancestor set of
  `target_node_id` contains a `long_running: true` node.
- `{"error": "node '<id>' has no Table output named '<port>'"}` — wrong
  port name, or the port's declared type isn't `Table`.
- Any other node execution failure upstream (bad file path, malformed
  CSV, etc.) surfaces as the existing `ExecutorError` message, tagged with
  the failing node's id — same shape as a real run's error reporting.

**Implementation (`vmb_engine/executor.py`):**

1. A new helper `ancestors_of(nodes, edges, target_node_id) -> set[str]`
   next to `topological_sort` — walks edges backward from
   `target_node_id`, collecting every node that (transitively) feeds it,
   plus itself. Pure function, unit-testable on a small IR fixture
   (diamond DAG, disconnected branch not included, etc.).
2. A new function `execute_subgraph_preview(ir, target_node_id, port)`:
   - Compute `ancestors_of(...)`.
   - If any ancestor node's manifest has `long_running: true`, raise a new
     `PreviewError` (mapped to 422 in `api.py`, same pattern as
     `ExecutorError`/`RegistryError`).
   - Run `topological_sort` restricted to that ancestor set, then execute
     each node via the *same* per-node `execute()` call the real executor
     uses (no reimplementation — literally reuses the existing node-loop
     body, just over a smaller node list).
   - Look up `context[f"{target_node_id}.{port}"]`. If missing or not a
     DataFrame, raise `PreviewError`.
   - Serialize: `columns` from `df.dtypes`, `rows` from
     `df.head(50).values.tolist()`, `total_rows` from `len(df)`.
3. `api.py` gets `POST /pipeline/preview` wired to this function,
   `PreviewError` mapped to 422 alongside the existing `ExecutorError`/
   `RegistryError` mappings.

This is additive: no changes to `execute_pipeline`, `topological_sort`, or
`codegen.py`. The equivalence test suite is unaffected since this path
never touches codegen.

## Manifest schema: `options_source` for dynamic-select params

Today (`api/types.ts`'s `ParamSpec`, mirrored in every manifest.json), a
`"type": "select"` param has a static `options: string[]`. This adds a
second, mutually exclusive way to populate options:

```json
{
  "name": "target_column",
  "type": "select",
  "label": "Target Column",
  "default": "",
  "options_source": { "input_port": "train_table" }
}
```

`options_source.input_port` names one of the node's own declared
`inputs` — the port whose upstream `Table`'s columns become this param's
dropdown options. A param has either `options` or `options_source`, never
both; `ParamSpec` (TypeScript) and the Pydantic param-schema model both
gain `options_source` as an optional field.

**Nodes updated to use it:** every node with a free-text
`target_column`-shaped param —
`sklearn_models/{linear_regression,logistic_regression,random_forest,svm}`,
`pytorch_models/train`, and `preprocessing/{standardize,one_hot_encode}`
(whose `target_column (excluded)` param is the same shape, just excluding
rather than selecting the column). (`kmeans` is unsupervised, no target
column, untouched.) In each case `options_source.input_port` points at
that node's existing `train_table` input — no new ports, just a schema
annotation on an existing param.

## Frontend: dynamic dropdown (Inspector)

`InspectorPanel.tsx` currently receives only the selected `node`. It needs
the pipeline's `edges` too, to find what feeds a given input port.

For each param with `options_source`:
1. Find the edge (if any) whose `to` is `{selected_node_id}.{input_port}`.
2. If none: render the select disabled, with a placeholder option
   ("Connect input to see columns").
3. If one exists: call `POST /pipeline/preview` with `target_node_id` /
   `port` set to that edge's *source* node/port, using the pipeline as it
   currently exists on canvas. While in flight, show the select disabled
   with a loading placeholder. On success, populate options from
   `columns[].name`, preserving the current param value if it's still a
   valid option (clearing it otherwise). On error (e.g. `PreviewError` for
   a bad upstream path), show the select disabled with the error message
   as the placeholder — never silently empty.
4. Requests are cancelled/ignored if the user changes node selection or
   the input's upstream wiring changes before the response returns, so a
   stale response can't populate the wrong node's dropdown.
5. Cache the last successful result per `(source node id, source port,
   upstream pipeline JSON)` so reselecting the same already-previewed node
   doesn't refire the request every time — invalidated whenever the
   upstream subgraph's JSON changes.

## Frontend: Data Preview Panel

New module `apps/frontend/src/preview/`, parallel to the existing
`training/` module:

- **`usePreview` hook** — owns `{status: 'idle' | 'loading' | 'success' |
  'error', data, error}` and exposes `runPreview(nodeId, port)`, which
  calls `POST /pipeline/preview` and updates state. A plain
  request/response call (no WebSocket) — preview is scoped to
  non-`long_running` data-prep nodes, so it's bounded and fast enough to
  await directly, unlike training.
- **`PreviewPanel.tsx`** — a panel docked to the right side of the canvas
  (not a full-screen modal like `TrainingMonitor`, so the canvas stays
  visible), showing:
  - A `<table>` of the sample rows, column names as headers with dtype
    shown as a small subscript under each name.
  - A footer: `"Showing 50 of 4,200 rows"` (or the exact count if
    `total_rows <= 50`).
  - A close button.
  - A loading spinner / inline error message using `usePreview`'s state.
- **Trigger:** `InspectorPanel.tsx` gets a "Preview Output" button for any
  node with at least one `Table`-typed output. A node with exactly one
  Table output gets one button; a node with two (e.g.
  `preprocessing/standardize`'s `train`/`test`) gets two labeled buttons
  ("Preview train", "Preview test") — simpler than a picker, and no
  current node has more than two Table outputs.
- **State ownership:** `App.tsx` holds `previewTarget: {nodeId, port} |
  null`, the same pattern `activeRunId` already uses for
  `TrainingMonitor` — one open preview panel at a time; opening a new one
  or closing replaces/clears it.

## Frontend: Metrics formatting

Both current raw-JSON call sites (`App.tsx`'s run-result list,
`TrainingMonitor.tsx`'s completion view) are replaced by one shared
`MetricsView` component (`apps/frontend/src/metrics/MetricsView.tsx`),
given the `Metrics` dict for a single node's output:

- **`confusion_matrix` + `labels` pair** (detected by key name/shape):
  rendered as a `<table>` grid — `labels` as both row and column headers,
  cell values as counts, diagonal cells given a distinct background so
  correct-vs-misclassified is visually obvious at a glance.
- **Scalar numeric values** (`accuracy`, `final_val_accuracy`, `r2`, loss
  values, etc.): rendered as labeled stat rows — key title-cased (e.g.
  `final_val_accuracy` → "Final Val Accuracy"), value formatted to 4
  significant figures.
- **Anything else** (unrecognized key or shape — e.g. a future metric this
  component doesn't know about): falls back to a formatted `<pre>` block
  (pretty-printed JSON, not inline-stringified) rather than a special case
  per unknown key — keeps the component from needing updates every time a
  new metric is added elsewhere, while still being more readable than
  today's single-line JSON.

`App.tsx`'s run-result list and `TrainingMonitor.tsx`'s completion view
both iterate their existing `{ref: "{node_id}.{port}", value}` pairs and
render `<MetricsView metrics={value} />` per pair, with the `ref` string
kept as a small heading above each node's metrics block (unchanged from
today, so results from different nodes stay visually distinguishable).

## Error Handling Summary

| Scenario | Behavior |
|---|---|
| Preview requested past a `long_running` ancestor | 422 `PreviewError`, surfaced inline in panel/dropdown |
| Preview target port isn't a `Table` / doesn't exist | 422 `PreviewError` |
| Upstream node execution fails (bad path, bad data) | Existing `ExecutorError` shape, tagged with failing node id |
| Dropdown's input port not connected | Disabled select, placeholder text, no request sent |
| Stale preview/dropdown response after selection changes | Discarded, never applied to UI |
| Unrecognized `Metrics` shape | `MetricsView` falls back to formatted `<pre>`, never raw single-line JSON |

## Testing

- **Engine:** unit tests for `ancestors_of` (diamond DAG, disconnected
  branch excluded, target-node-itself included); tests for
  `execute_subgraph_preview`'s serialization (correct dtypes, 50-row cap,
  accurate `total_rows`, both success and each `PreviewError` case);
  an `api.py` test hitting `POST /pipeline/preview` end-to-end for a
  small CSV-loader pipeline.
- **Frontend:** `usePreview` hook tests (loading/success/error
  transitions); `PreviewPanel` rendering test (rows/columns/footer count,
  loading and error states); Inspector dropdown tests (auto-load on
  connected input, disabled-with-placeholder on disconnected input,
  stale-response discard); `MetricsView` tests (scalar formatting,
  confusion-matrix grid structure and diagonal highlighting, fallback
  path for an unrecognized shape).

## Open Questions (resolved during brainstorming, recorded for traceability)

- **Preview trigger** → a button in the Inspector for the selected node
  (not a canvas-level icon, not automatic after every Run) — keeps
  preview an explicit, on-demand action tied to the existing
  select-a-node interaction model.
- **Preview execution model** → run the subgraph up to the target node on
  demand, independent of any full pipeline Run — avoids requiring an
  expensive full run (including downstream training) just to peek at
  early data-prep output, and avoids staleness if upstream params change
  after the last full run.
- **Dropdown population** → auto-load on node selection when the input is
  connected (not a manual "Load columns" button) — matches "should be
  drop downs from the data available" as a low-friction default, with a
  disabled/placeholder fallback keeping the control safe when there's
  nothing to load yet.
- **New endpoint vs. extending `/pipeline/run`** → new dedicated
  `/pipeline/preview` endpoint chosen over adding a preview flag to
  `/pipeline/run`, to keep "run the pipeline for real" and "peek at
  intermediate data" from being conflated, and to avoid ever serializing
  large tables during a normal run.
