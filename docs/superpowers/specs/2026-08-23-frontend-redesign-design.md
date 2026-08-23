# Visual Model Builder — Frontend Redesign Design Spec

**Date:** 2026-08-23
**Status:** Approved for implementation
**Parent specs:** `docs/superpowers/specs/2026-08-21-vmb-frontend-design.md`,
`docs/superpowers/specs/2026-08-22-frontend-nn-training-design.md`,
`docs/superpowers/specs/2026-08-22-pipeline-preview-and-metrics-viz-design.md`

## Overview

The current frontend (`apps/frontend/`) is functionally complete — canvas,
palette, inspector, run, code view, data preview, training monitor — but
visually and structurally ad hoc: a three-column flex layout
(palette | canvas | inspector) with results dumped in a header banner, data
preview as a fixed-position drawer, training progress as a full-screen modal
takeover, zero design tokens, and hardcoded hex colors scattered through a
single 292-line `index.css`.

This redesign restructures the app into a four-zone, drag-resizable layout
(nodes left, canvas center, params right, output bottom-left, visualizations
bottom-right), introduces a dark, token-based design system, adds live
node/edge run-state animation on the canvas, and consolidates all charting
(metrics, training curves, data distributions) into one visualizations
panel. It is a layout, styling, and panel-composition change — no engine
changes, no new API surface, no change to what data is fetched or how
pipelines execute.

## Goals

- Replace the 3-column layout with a 4-zone resizable layout (drag dividers,
  persisted across sessions) that reads as a modern, IDE-like tool.
- Introduce a CSS custom-property token system (color, spacing, radius,
  shadow, typography) replacing all hardcoded hex literals, dark theme only.
- Consolidate results display: a bottom-left **Output** panel (tabs: Results
  / Data Preview) replaces today's header banner and fixed-position preview
  drawer.
- Consolidate charting: a bottom-right **Visualizations** panel replaces
  today's inline `MetricsView` charts and the full-screen `TrainingMonitor`
  modal — metrics charts, data-distribution histograms, and live training
  curves all render here.
- Add interactive run feedback: node status rings/glow (idle/running/success/
  error) and animated edges on the canvas, a "Running…" button state, tab
  and panel-content transitions.
- Preserve all existing behavior and data flow (what gets fetched, when, and
  via which hook) — this is a presentation-layer restructuring, not a
  rewrite of `api/`, `ir/convert.ts`, or the engine-facing hooks.

## Non-goals

- No engine (`engine/`) changes of any kind.
- No new API endpoints or changes to existing request/response shapes.
- No light theme / theme toggle — dark only, per the approved direction.
- No state-management library (Zustand, Redux, Context-based store) — state
  stays in `App.tsx`, threaded via props, as today. Only *which* component
  receives *which* prop slice changes.
- No change to the generated-code view's presentation mode — it stays a
  full-screen overlay modal, just restyled to match the new theme.
- No mobile/responsive layout — this is a desktop app (Tauri shell); no
  breakpoint work for narrow viewports.
- No Tailwind or other CSS/UI framework adoption — plain CSS with custom
  properties, matching the existing approach.

## Architecture

### Layout

Built with `react-resizable-panels` (new dependency, ~9kb, unstyled,
MIT-licensed, used by production tools like Vercel's own dashboards):
supplies draggable-divider `<PanelGroup>`/`<Panel>` primitives; all visual
styling (divider appearance, hover states) is our own CSS against the new
token system.

```
apps/frontend/src/
  layout/
    AppLayout.tsx         # top-level PanelGroup: vertical split of
                           # (top row) / (bottom row)
    TopRow.tsx             # horizontal PanelGroup: palette | canvas | inspector
    BottomRow.tsx           # horizontal PanelGroup: output | visualizations
  ...
```

- Outer split: vertical, `top` (default ~65%) / `bottom` (default ~35%),
  `autoSaveId="vmb-layout-outer"`.
- Top row: horizontal, `palette` (fixed-ish, min 180px) / `canvas` (flex,
  min 400px, gets remaining space by default) / `inspector` (min 260px),
  `autoSaveId="vmb-layout-top"`.
- Bottom row: horizontal, `output` (default 50%) / `visualizations` (default
  50%), `autoSaveId="vmb-layout-bottom"`.
- `autoSaveId` persists divider positions to `localStorage` automatically
  (a `react-resizable-panels` built-in) — no custom persistence code needed.
- `App.tsx` shrinks to: top-level state + mutations (unchanged from today)
  plus rendering `<AppLayout>` with the header above it. It no longer
  contains layout JSX itself — that moves into `layout/`.

### Design tokens

New `src/theme.css` (imported once, before `index.css`), defining CSS custom
properties on `:root`:

```css
:root {
  /* surfaces, darkest to lightest */
  --color-bg-canvas: #14161a;
  --color-bg-panel: #1b1e24;
  --color-bg-elevated: #24282f;   /* header, modals, dropdowns */
  --color-border: #30343c;

  /* text */
  --color-text-primary: #e8e9ec;
  --color-text-secondary: #9198a3;

  /* accent + semantic */
  --color-accent: #6c8cff;         /* primary actions, active states, running-node glow */
  --color-success: #3ecf8e;
  --color-error: #ef5a5a;
  --color-warning: #e8a944;

  /* spacing (4px base) */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px;

  /* radius */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;

  /* shadow (elevated surfaces: modal, dropdowns) */
  --shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.4);

  /* typography */
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SF Mono", Consolas, "Liberation Mono", monospace;
}
```

Exact accent hex may be adjusted during implementation for contrast/
accessibility (WCAG AA against `--color-bg-panel` for text-on-accent use),
but the token *names* and their usage sites are fixed by this spec so every
component references tokens, never literals. `index.css` is rewritten
component-section by component-section to consume these tokens instead of
its current inline hex values; no component keeps a hardcoded color.

### Component changes

| Today | Becomes |
|---|---|
| `App.tsx` (123 lines, owns layout JSX) | `App.tsx` (state/mutations only) + `layout/AppLayout.tsx`, `layout/TopRow.tsx`, `layout/BottomRow.tsx` |
| Header banner showing flat `MetricsView` list | Removed; results move into `OutputPanel`'s Results tab |
| `preview/PreviewPanel.tsx` (fixed 480px drawer) | Re-hosted, unchanged internals, inside `output/OutputPanel.tsx`'s Data Preview tab |
| `training/TrainingMonitor.tsx` (full-screen modal) | Removed as a modal; its `useTrainingRun` hook is reused by `visualizations/VisualizationsPanel.tsx`, which renders the live curve in place |
| `metrics/MetricsView.tsx` (98 lines, mixed dict/table/confusion-matrix/hand-rolled-SVG-ROC) | Split: non-chart parts (metrics dict/table) move to `output/OutputPanel.tsx`'s Results tab; chart parts (confusion matrix heatmap, ROC curve) move to `visualizations/VisualizationsPanel.tsx`, ROC migrated from hand-rolled SVG to Recharts |
| *(new)* | `visualizations/VisualizationsPanel.tsx`: tabs or stacked sections for Metrics Charts / Data Distributions / Training Curve, shown contextually (training curve only appears during/after a long-running run) |
| *(new)* | `output/OutputPanel.tsx`: tab container (Results / Data Preview) |
| `canvas/PipelineCanvas.tsx` (270 lines) | Adds per-node status prop (`idle` / `running` / `success` / `error`) driving a CSS class on each node for the ring/glow treatment; adds `animated: true` on edges feeding a currently-running node (native React Flow edge prop) |
| `codeview/CodeViewPanel.tsx` | Unchanged structurally; restyled against tokens |

`NodePalette.tsx` and `InspectorPanel.tsx`/`params/*` are unchanged in
structure — they're re-parented into `TopRow.tsx` and restyled against
tokens.

### Data flow

No change to *what* is fetched or *when*. Only *which component instance*
receives the resulting state changes:

1. `App.tsx` still owns `nodes`, `edges`, `selectedNodeId`, run mutation
   state, and the training-run hook's state, exactly as today.
2. Sync run results (`useRunPipeline()` mutation data) are passed to
   `OutputPanel` (Results tab) instead of being rendered directly under the
   header, and to `VisualizationsPanel` (Metrics Charts section) for the
   chartable subset (confusion matrix, ROC).
3. `useTrainingRun()`'s WebSocket-streamed progress is passed to
   `VisualizationsPanel` (Training Curve section) instead of mounting
   `TrainingMonitor` as a modal. The canvas also receives run/node status
   from the same stream to drive per-node glow state — `progress` events
   already carry a `node_id`, mapped to `running`; `complete`/`node_error`
   map to `success`/`error` for that node.
4. `usePreview()` (per-node/port data preview) is passed to `OutputPanel`
   (Data Preview tab) instead of a fixed drawer; triggering behavior
   (inspector button click → fetch → show) is unchanged.
5. Data-distribution histograms (new, in `VisualizationsPanel`) are computed
   client-side from the same `Table` data `usePreview()` already returns —
   no new fetch, no new engine endpoint. Numeric columns get a binned
   histogram (Recharts `BarChart`); this is a lightweight addition, not a
   general-purpose charting feature — if a column's dtype isn't numeric it's
   skipped, no error state needed.

### Interactive run states

- **Node status**: `PipelineCanvas` derives a `status` per node from the
  active run's state (`idle` default; `running` while its `progress` events
  are arriving or while a sync run is in flight and this node hasn't
  resolved; `success`/`error` on its terminal event) and applies a CSS class
  consumed by `theme.css` tokens — `running` uses `--color-accent` in a
  pulsing box-shadow animation (`@keyframes`, CSS only, no JS animation
  library), `success` briefly uses `--color-success` then fades back to
  idle, `error` holds `--color-error` until the next run starts.
- **Edges**: edges whose target node is `running` get React Flow's built-in
  `animated: true` (dashed marching-ants effect, no custom implementation).
- **Run button**: while a run mutation/training run is in flight, the button
  renders a small CSS spinner + "Running…" label and is disabled; reverts on
  settle (success or error).
- **Panel/tab transitions**: CSS `transition` on tab underline position and
  a brief opacity/translate fade-in on newly-rendered tab content — no
  animation library, plain CSS.

## Error Handling

Unchanged from the current design — engine-unreachable banner, inline 422
`detail` display near the triggering control, invalid-connection prevention
at drop time. The only difference is *where* run-error detail renders: the
Results tab of `OutputPanel` instead of the removed header banner. A
node-level error (from a streamed `node_error` event) additionally surfaces
as that node's red status ring on the canvas, so the failing node is visible
without opening the Output panel.

## Testing Strategy

- **`layout/AppLayout.tsx` / `TopRow.tsx` / `BottomRow.tsx`**: render tests
  confirming all expected children mount; `react-resizable-panels` itself is
  a well-tested upstream dependency, not re-tested here.
- **`output/OutputPanel.tsx`**: tab-switching test (Results ⇄ Data Preview),
  and that existing `PreviewPanel`/results-rendering tests still pass
  re-parented (update imports/mount points, not assertions).
- **`visualizations/VisualizationsPanel.tsx`**: one rendering test per
  section (metrics chart given mock metrics, histogram given mock `Table`
  data, training curve given mock `useTrainingRun` state), plus a test that
  the training-curve section only appears when a long-running run is
  active/completed.
- **`canvas/PipelineCanvas.tsx`**: extend existing tests with cases for each
  node status class (`idle`/`running`/`success`/`error`) and animated-edge
  behavior given a node in `running` state.
- **Existing tests** (`convert.test.ts`, `validation.test.ts`,
  `InspectorPanel.test.tsx`, param control tests) are unaffected — no
  changes to the code they cover.
- **No E2E/browser automation** — acceptance is the unit suite passing plus
  a manual pass: start engine + Vite dev servers, build and run a sync
  pipeline (results in Output tab, confusion-matrix/ROC in Visualizations
  tab), run a long-running (pytorch) pipeline (canvas node glow, animated
  edges, live curve in Visualizations panel, no modal takeover), trigger a
  422 error (red node ring + inline error text), resize and reload to
  confirm panel-size persistence, open View Code to confirm the modal is
  restyled but otherwise unchanged.

## Tech Stack Changes

- **New dependency**: `react-resizable-panels` (layout).
- **Existing `recharts`**: extended — ROC curve migrates from hand-rolled
  SVG to a Recharts `LineChart`; new histogram sections use Recharts
  `BarChart`.
- No other dependency changes. No build-tool config changes (Vite config
  untouched).

## Future Work (explicitly out of scope for this spec)

- Light theme / theme toggle.
- Making the code view part of the persistent layout instead of an overlay
  (considered and explicitly rejected for this redesign — see brainstorming
  discussion).
- Any new chart types beyond metrics/histograms/training curves (e.g.
  feature-importance plots) — add if/when a node produces that data.
- Collapsing/hiding entire panels (e.g. a "zen mode" that hides
  palette+inspector) — no requirement driving it yet.
