# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 3-column, untokened frontend layout with a
four-zone resizable layout (nodes left, canvas center, params right, output
bottom-left, visualizations bottom-right), a dark token-based design system,
and interactive run-state feedback on the canvas.

**Architecture:** All state stays in `App.tsx`, threaded via props (no new
state library). New layout primitives (`layout/`) wrap existing panels in
`react-resizable-panels`. Two new panels — `output/OutputPanel.tsx` (tabs:
Results / Data Preview) and `visualizations/VisualizationsPanel.tsx`
(metrics charts / data histograms / live training curve) — absorb
responsibilities currently split across a header banner, a fixed preview
drawer, and a full-screen training modal. `metrics/MetricsView.tsx` is split
into a non-chart `MetricsSummary` (Results tab) and a chart-only
`MetricsCharts` (Visualizations panel, migrated from hand-rolled SVG to
Recharts).

**Tech Stack:** React 19 + TypeScript, `@xyflow/react` v12 (canvas),
`recharts` (existing, extended), `react-resizable-panels` v2 (new,
resizable layout), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-23-frontend-redesign-design.md`

## Global Constraints

- `react-resizable-panels` MUST be pinned to the `^2.1.9` range (classic
  `Panel`/`PanelGroup`/`PanelResizeHandle` API with `autoSaveId`). Do not
  install a `3.x`/`4.x` version — those releases replace this API with
  `Group`/`Separator` and `defaultLayout`, which this plan does not use.
- Dark theme only. Every new or edited component references CSS custom
  properties from `src/theme.css` (`--color-*`, `--space-*`, `--radius-*`,
  `--shadow-*`, `--font-*`) — never a hardcoded hex/rgb literal in new CSS.
- No new state-management library. All cross-panel state
  (`nodes`/`edges`/`selectedNodeId`/`outputTab`/`activeRunId`/mutation
  state) stays in `App.tsx` and flows down via props, exactly as today.
- The generated-code view (`codeview/CodeViewPanel.tsx`) stays a
  full-screen overlay modal — it is not folded into the resizable layout.
- All commands in this plan run from `apps/frontend/` unless stated
  otherwise. Run `npm test` (Vitest) and `npm run build` (`tsc --noEmit &&
  vite build`) after each task; both must pass before committing.

---

## Task 1: Dependency + design tokens foundation

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/src/theme.css`
- Modify: `apps/frontend/src/main.tsx`
- Test: `apps/frontend/tests/theme.test.ts`

**Interfaces:**
- Produces: CSS custom properties on `:root` — `--color-bg-canvas`,
  `--color-bg-panel`, `--color-bg-elevated`, `--color-border`,
  `--color-text-primary`, `--color-text-secondary`, `--color-accent`,
  `--color-success`, `--color-error`, `--color-warning`, `--space-1`
  through `--space-6`, `--radius-sm`, `--radius-md`, `--radius-lg`,
  `--shadow-elevated`, `--font-ui`, `--font-mono`. Every later task's CSS
  consumes these by name.

- [ ] **Step 1: Install the layout dependency**

Run: `cd apps/frontend && npm install react-resizable-panels@2.1.9`

Confirm `package.json`'s `dependencies` gained
`"react-resizable-panels": "^2.1.9"`.

- [ ] **Step 2: Write the failing token-completeness test**

Create `tests/theme.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const themeCss = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf-8')

const REQUIRED_TOKENS = [
  '--color-bg-canvas',
  '--color-bg-panel',
  '--color-bg-elevated',
  '--color-border',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-accent',
  '--color-success',
  '--color-error',
  '--color-warning',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-elevated',
  '--font-ui',
  '--font-mono',
]

describe('theme.css', () => {
  it('defines every required design token on :root', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(themeCss).toMatch(new RegExp(`${token}\\s*:`))
    }
  })
})
```

- [ ] **Step 2b: Run it to confirm it fails**

Run: `npm test -- theme.test.ts`
Expected: FAIL — `src/theme.css` does not exist yet.

- [ ] **Step 3: Create the tokens file**

Create `src/theme.css`:

```css
:root {
  /* surfaces, darkest to lightest */
  --color-bg-canvas: #14161a;
  --color-bg-panel: #1b1e24;
  --color-bg-elevated: #24282f;
  --color-border: #30343c;

  /* text */
  --color-text-primary: #e8e9ec;
  --color-text-secondary: #9198a3;

  /* accent + semantic */
  --color-accent: #6c8cff;
  --color-success: #3ecf8e;
  --color-error: #ef5a5a;
  --color-warning: #e8a944;

  /* spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* shadow (elevated surfaces: modal, dropdowns) */
  --shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.4);

  /* typography */
  --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', Consolas, 'Liberation Mono', monospace;
}
```

- [ ] **Step 4: Import it before `index.css`**

Modify `src/main.tsx` — change:

```tsx
import '@xyflow/react/dist/style.css'
import './index.css'
```

to:

```tsx
import '@xyflow/react/dist/style.css'
import './theme.css'
import './index.css'
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- theme.test.ts`
Expected: PASS

- [ ] **Step 6: Full suite + build sanity check**

Run: `npm test && npm run build`
Expected: both pass (no other file references anything new yet).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/theme.css src/main.tsx tests/theme.test.ts
git commit -m "frontend: add react-resizable-panels dependency and design tokens"
```

---

## Task 2: Split metrics rendering — `metricsHelpers` + `MetricsSummary`

Replaces `metrics/MetricsView.tsx` (which mixed scalar/table rendering with
confusion-matrix/ROC chart rendering) with a shared helpers module and a
`MetricsSummary` component that renders only the non-chart parts. The
chart-only counterpart (`MetricsCharts`) is built in Task 3.

**Files:**
- Create: `apps/frontend/src/metrics/metricsHelpers.ts`
- Create: `apps/frontend/src/metrics/MetricsSummary.tsx`
- Delete: `apps/frontend/src/metrics/MetricsView.tsx`
- Modify: `apps/frontend/src/App.tsx` (import/usage rename only)
- Modify: `apps/frontend/src/training/TrainingMonitor.tsx` (import/usage rename only)
- Test: Create `apps/frontend/tests/metricsHelpers.test.ts`
- Test: Rename `apps/frontend/tests/MetricsView.test.tsx` → `apps/frontend/tests/MetricsSummary.test.tsx`

**Interfaces:**
- Produces: `formatMetricKey(key: string): string`,
  `nonChartMetrics(metrics: Record<string, unknown>): Record<string, unknown>`,
  `extractConfusionMatrix(metrics: Record<string, unknown>): ConfusionMatrixData | null`,
  `extractRocCurve(metrics: Record<string, unknown>): RocCurveData | null`
  from `metrics/metricsHelpers.ts` — Task 3's `MetricsCharts` and Task 7's
  `VisualizationsPanel` both import `extractConfusionMatrix`/`extractRocCurve`
  from here.
  `MetricsSummary({ metrics }: MetricsSummaryProps)` from
  `metrics/MetricsSummary.tsx` — Task 6's `OutputPanel` imports this.

- [ ] **Step 1: Write the failing helpers test**

Create `tests/metricsHelpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  extractConfusionMatrix,
  extractRocCurve,
  formatMetricKey,
  nonChartMetrics,
} from '../src/metrics/metricsHelpers'

describe('formatMetricKey', () => {
  it('title-cases snake_case keys', () => {
    expect(formatMetricKey('final_val_loss')).toBe('Final Val Loss')
  })
})

describe('nonChartMetrics', () => {
  it('strips confusion-matrix and ROC keys, keeping the rest', () => {
    const result = nonChartMetrics({
      accuracy: 0.9,
      confusion_matrix: [[1, 0], [0, 1]],
      labels: [0, 1],
      fpr: [0, 1],
      tpr: [0, 1],
    })
    expect(result).toEqual({ accuracy: 0.9 })
  })
})

describe('extractConfusionMatrix', () => {
  it('returns matrix + labels when both are present', () => {
    const result = extractConfusionMatrix({ confusion_matrix: [[1, 0], [0, 1]], labels: [0, 1] })
    expect(result).toEqual({ matrix: [[1, 0], [0, 1]], labels: [0, 1] })
  })

  it('returns null when absent', () => {
    expect(extractConfusionMatrix({ accuracy: 0.9 })).toBeNull()
  })
})

describe('extractRocCurve', () => {
  it('returns fpr + tpr when both are present', () => {
    expect(extractRocCurve({ fpr: [0, 1], tpr: [0, 1] })).toEqual({ fpr: [0, 1], tpr: [0, 1] })
  })

  it('returns null when absent', () => {
    expect(extractRocCurve({ accuracy: 0.9 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- metricsHelpers.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `metricsHelpers.ts`**

Create `src/metrics/metricsHelpers.ts`:

```ts
export interface ConfusionMatrixData {
  matrix: number[][]
  labels: unknown[]
}

export interface RocCurveData {
  fpr: number[]
  tpr: number[]
}

export function extractConfusionMatrix(metrics: Record<string, unknown>): ConfusionMatrixData | null {
  if (Array.isArray(metrics.confusion_matrix) && Array.isArray(metrics.labels)) {
    return { matrix: metrics.confusion_matrix as number[][], labels: metrics.labels as unknown[] }
  }
  return null
}

export function extractRocCurve(metrics: Record<string, unknown>): RocCurveData | null {
  if (Array.isArray(metrics.fpr) && Array.isArray(metrics.tpr)) {
    return { fpr: metrics.fpr as number[], tpr: metrics.tpr as number[] }
  }
  return null
}

const CHART_KEYS = new Set(['confusion_matrix', 'labels', 'fpr', 'tpr'])

export function nonChartMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metrics).filter(([key]) => !CHART_KEYS.has(key)))
}

export function formatMetricKey(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
```

- [ ] **Step 4: Run the helpers test to confirm it passes**

Run: `npm test -- metricsHelpers.test.ts`
Expected: PASS

- [ ] **Step 5: Rename the MetricsView test file and rewrite it for MetricsSummary**

Delete `tests/MetricsView.test.tsx`, create `tests/MetricsSummary.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsSummary } from '../src/metrics/MetricsSummary'

describe('MetricsSummary', () => {
  it('renders scalar metrics as formatted stat rows', () => {
    render(<MetricsSummary metrics={{ accuracy: 0.913456, final_val_loss: 0.2 }} />)

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9135')).toBeInTheDocument()
    expect(screen.getByText('Final Val Loss')).toBeInTheDocument()
    expect(screen.getByText('0.2000')).toBeInTheDocument()
  })

  it('ignores confusion-matrix and ROC keys, rendering only the remaining scalars', () => {
    render(
      <MetricsSummary
        metrics={{
          accuracy: 0.9,
          confusion_matrix: [
            [8, 3],
            [2, 9],
          ],
          labels: [0, 1],
        }}
      />,
    )

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('falls back to a formatted block for an unrecognized metrics shape', () => {
    render(<MetricsSummary metrics={{ weird: { nested: true } }} />)

    expect(screen.getByText(/"weird"/)).toBeInTheDocument()
  })

  it('renders nothing when only chart keys are present', () => {
    const { container } = render(<MetricsSummary metrics={{ fpr: [0, 1], tpr: [0, 1] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- MetricsSummary.test.tsx`
Expected: FAIL — `src/metrics/MetricsSummary.tsx` does not exist.

- [ ] **Step 7: Create `MetricsSummary.tsx` and delete `MetricsView.tsx`**

Create `src/metrics/MetricsSummary.tsx`:

```tsx
import { formatMetricKey, nonChartMetrics } from './metricsHelpers'

export interface MetricsSummaryProps {
  metrics: Record<string, unknown>
}

export function MetricsSummary({ metrics }: MetricsSummaryProps) {
  const entries = Object.entries(nonChartMetrics(metrics))

  if (entries.length === 0) {
    return null
  }

  const allScalar = entries.every(([, value]) => typeof value === 'number')
  if (allScalar) {
    return (
      <dl className="metrics-view">
        {entries.map(([key, value]) => (
          <div className="metrics-stat" key={key}>
            <dt>{formatMetricKey(key)}</dt>
            <dd>{(value as number).toPrecision(4)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return <pre className="metrics-fallback">{JSON.stringify(Object.fromEntries(entries), null, 2)}</pre>
}
```

Delete `src/metrics/MetricsView.tsx`.

- [ ] **Step 8: Fix the two consumers**

Modify `src/App.tsx`: change the import
`import { MetricsView } from './metrics/MetricsView'` to
`import { MetricsSummary } from './metrics/MetricsSummary'`, and the usage
`<MetricsView metrics={value as Record<string, unknown>} />` to
`<MetricsSummary metrics={value as Record<string, unknown>} />`.

Modify `src/training/TrainingMonitor.tsx`: same rename — import
`MetricsSummary` from `'../metrics/MetricsSummary'` instead of `MetricsView`
from `'../metrics/MetricsView'`, and use `<MetricsSummary metrics={...} />`
in place of `<MetricsView metrics={...} />`.

- [ ] **Step 9: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all pass. (`App.test.tsx`'s sync-metrics test and
`TrainingMonitor.test.tsx`'s complete-metrics test only assert scalar
values, so they pass unchanged against `MetricsSummary`.)

- [ ] **Step 10: Commit**

```bash
git add src/metrics/metricsHelpers.ts src/metrics/MetricsSummary.tsx src/App.tsx src/training/TrainingMonitor.tsx tests/metricsHelpers.test.ts tests/MetricsSummary.test.tsx
git rm src/metrics/MetricsView.tsx tests/MetricsView.test.tsx
git commit -m "frontend: split MetricsView into metricsHelpers + non-chart MetricsSummary"
```

---

## Task 3: `MetricsCharts` — confusion matrix + ROC curve (Recharts)

Builds the chart-only counterpart to `MetricsSummary`, for the
Visualizations panel. Not wired into `App.tsx` yet — that happens in Task 7
via `VisualizationsPanel`.

**Files:**
- Create: `apps/frontend/src/visualizations/MetricsCharts.tsx`
- Test: `apps/frontend/tests/MetricsCharts.test.tsx`

**Interfaces:**
- Consumes: `extractConfusionMatrix`, `extractRocCurve` from
  `../metrics/metricsHelpers` (Task 2).
- Produces: `MetricsCharts({ metrics }: MetricsChartsProps)` — Task 7's
  `VisualizationsPanel` imports this from `./MetricsCharts`.

- [ ] **Step 1: Write the failing test**

Create `tests/MetricsCharts.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsCharts } from '../src/visualizations/MetricsCharts'

describe('MetricsCharts', () => {
  it('renders a confusion matrix as a labeled grid with the diagonal highlighted', () => {
    render(
      <MetricsCharts
        metrics={{
          confusion_matrix: [
            [8, 3],
            [2, 9],
          ],
          labels: [0, 1],
        }}
      />,
    )

    const table = screen.getByRole('table')
    const diagonalCells = table.querySelectorAll('.confusion-matrix-diagonal')
    expect(diagonalCells).toHaveLength(2)
    expect(diagonalCells[0]).toHaveTextContent('8')
    expect(diagonalCells[1]).toHaveTextContent('9')
  })

  it('renders an ROC curve chart when fpr/tpr are present', () => {
    const { container } = render(<MetricsCharts metrics={{ roc_auc: 0.9231, fpr: [0, 0.2, 1], tpr: [0, 0.8, 1] }} />)

    expect(container.querySelector('.roc-curve-chart')).not.toBeNull()
  })

  it('renders both sections when a confusion matrix and an ROC curve are both present', () => {
    const { container } = render(
      <MetricsCharts
        metrics={{
          confusion_matrix: [[1, 0], [0, 1]],
          labels: [0, 1],
          fpr: [0, 1],
          tpr: [0, 1],
        }}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelector('.roc-curve-chart')).not.toBeNull()
  })

  it('renders nothing when neither chart shape is present', () => {
    const { container } = render(<MetricsCharts metrics={{ accuracy: 0.9 }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- MetricsCharts.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `MetricsCharts.tsx`**

Create `src/visualizations/MetricsCharts.tsx`:

```tsx
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { extractConfusionMatrix, extractRocCurve } from '../metrics/metricsHelpers'

export interface MetricsChartsProps {
  metrics: Record<string, unknown>
}

const ROC_CHART_SIZE = 220

export function MetricsCharts({ metrics }: MetricsChartsProps) {
  const confusionMatrix = extractConfusionMatrix(metrics)
  const rocCurve = extractRocCurve(metrics)

  if (!confusionMatrix && !rocCurve) {
    return null
  }

  return (
    <div className="metrics-charts">
      {confusionMatrix && (
        <table className="confusion-matrix-table">
          <thead>
            <tr>
              <th />
              {confusionMatrix.labels.map((label, i) => (
                <th key={i}>{String(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {confusionMatrix.matrix.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>{String(confusionMatrix.labels[rowIndex])}</th>
                {row.map((count, colIndex) => (
                  <td key={colIndex} className={rowIndex === colIndex ? 'confusion-matrix-diagonal' : undefined}>
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rocCurve && (
        <LineChart
          className="roc-curve-chart"
          width={ROC_CHART_SIZE}
          height={ROC_CHART_SIZE}
          data={rocCurve.fpr.map((x, i) => ({ fpr: x, tpr: rocCurve.tpr[i] }))}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="fpr" type="number" domain={[0, 1]} />
          <YAxis dataKey="tpr" type="number" domain={[0, 1]} />
          <Tooltip />
          <Line type="monotone" dataKey="tpr" name="TPR" stroke="var(--color-accent)" dot={false} />
        </LineChart>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- MetricsCharts.test.tsx`
Expected: PASS

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/visualizations/MetricsCharts.tsx tests/MetricsCharts.test.tsx
git commit -m "frontend: add MetricsCharts (confusion matrix + ROC curve via Recharts)"
```

---

## Task 4: Node run-status type + training-state error `nodeId` + `nodeStatuses` helper

Adds the plumbing needed for per-node canvas status (used by Task 5): a
`NodeRunStatus` type, a `nodeId` on `useTrainingRun`'s error state (so a
`node_error` event can be attributed to the failing node), and a pure
function that derives a `{nodeId: status}` map from `TrainingState`.

**Files:**
- Modify: `apps/frontend/src/canvas/types.ts`
- Modify: `apps/frontend/src/training/useTrainingRun.ts`
- Create: `apps/frontend/src/training/nodeStatuses.ts`
- Test: Modify `apps/frontend/tests/useTrainingRun.test.ts`
- Test: Create `apps/frontend/tests/nodeStatuses.test.ts`

**Interfaces:**
- Produces: `NodeRunStatus = 'idle' | 'running' | 'success' | 'error'` from
  `canvas/types.ts`; `PipelineNodeData` gains an optional
  `status?: NodeRunStatus` field. `TrainingState`'s `'error'` variant gains
  an optional `nodeId?: string`. `nodeStatusesFromTrainingState(state:
  TrainingState): Record<string, NodeRunStatus>` from
  `training/nodeStatuses.ts` — Task 5's `PipelineCanvas` and Task 9's
  `App.tsx` both consume this.

- [ ] **Step 1: Add `NodeRunStatus` to `canvas/types.ts`**

Modify `src/canvas/types.ts`:

```ts
import type { Edge, Node } from '@xyflow/react'
import type { NodeManifest } from '../api/types'

export type NodeRunStatus = 'idle' | 'running' | 'success' | 'error'

export interface PipelineNodeData extends Record<string, unknown> {
  manifest: NodeManifest
  params: Record<string, unknown>
  status?: NodeRunStatus
}

export type PipelineNode = Node<PipelineNodeData>
export type PipelineEdge = Edge
```

- [ ] **Step 2: Update the failing `useTrainingRun` test for `nodeId`**

Modify `tests/useTrainingRun.test.ts` — change the
`'moves to error with the message on a node_error event'` test's assertion
from:

```ts
expect(result.current).toEqual({ status: 'error', history: [], error: 'CUDA out of memory' })
```

to:

```ts
expect(result.current).toEqual({ status: 'error', history: [], error: 'CUDA out of memory', nodeId: 'n5' })
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- useTrainingRun.test.ts`
Expected: FAIL — actual result has no `nodeId` yet.

- [ ] **Step 4: Add `nodeId` to the error variant and thread it through**

Modify `src/training/useTrainingRun.ts`:

Change the `TrainingState` union's error variant from:

```ts
  | { status: 'error'; history: ProgressEvent[]; error: string }
```

to:

```ts
  | { status: 'error'; history: ProgressEvent[]; error: string; nodeId?: string }
```

Change the final `return` inside `socket.onmessage`'s reducer (reached once
`data` has been narrowed past the `progress` and `complete` checks, so TS
already knows it's the `node_error` variant here) from:

```ts
          return { status: 'error', history: prev.history, error: data.error }
```

to:

```ts
          return { status: 'error', history: prev.history, error: data.error, nodeId: data.node_id }
```

(The separate `handleDisconnect` function's own
`{ status: 'error', history: prev.history, error: 'connection lost' }`
literal, used for the "socket closed before a terminal event" case, is
untouched — it has no `node_id` to attribute the error to, so its state
object correctly omits `nodeId`.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- useTrainingRun.test.ts`
Expected: PASS (all cases, including the unchanged "connection lost" case,
whose expected object has no `nodeId` key — `toEqual` treats a missing key
the same as an explicit `undefined`, so it still matches.)

- [ ] **Step 6: Write the failing `nodeStatuses` test**

Create `tests/nodeStatuses.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nodeStatusesFromTrainingState } from '../src/training/nodeStatuses'

describe('nodeStatusesFromTrainingState', () => {
  it('marks every node that has emitted progress as running', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'running',
      history: [
        { event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 },
        { event: 'progress', node_id: 'n5', epoch: 2, loss: 0.4, val_loss: 0.5 },
        { event: 'progress', node_id: 'n7', epoch: 1, loss: 0.3, val_loss: 0.4 },
      ],
    })

    expect(result).toEqual({ n5: 'running', n7: 'running' })
  })

  it('marks every node that reported progress as success once the run completes', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'complete',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      metrics: {},
    })

    expect(result).toEqual({ n5: 'success' })
  })

  it('marks the failing node as error when a node_error carried a nodeId', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'error',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      error: 'CUDA out of memory',
      nodeId: 'n5',
    })

    expect(result).toEqual({ n5: 'error' })
  })

  it('returns an empty map for a connecting state with no history', () => {
    expect(nodeStatusesFromTrainingState({ status: 'connecting', history: [] })).toEqual({})
  })

  it('does not mark any node as error when the error has no nodeId (e.g. connection lost)', () => {
    const result = nodeStatusesFromTrainingState({
      status: 'error',
      history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
      error: 'connection lost',
    })

    expect(result).toEqual({ n5: 'running' })
  })
})
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npm test -- nodeStatuses.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 8: Create `nodeStatuses.ts`**

Create `src/training/nodeStatuses.ts`:

```ts
import type { NodeRunStatus } from '../canvas/types'
import type { TrainingState } from './useTrainingRun'

export function nodeStatusesFromTrainingState(state: TrainingState): Record<string, NodeRunStatus> {
  const statuses: Record<string, NodeRunStatus> = {}

  for (const event of state.history) {
    statuses[event.node_id] = 'running'
  }

  if (state.status === 'complete') {
    for (const nodeId of Object.keys(statuses)) {
      statuses[nodeId] = 'success'
    }
  }

  if (state.status === 'error' && state.nodeId) {
    statuses[state.nodeId] = 'error'
  }

  return statuses
}
```

- [ ] **Step 9: Run the test to confirm it passes**

Run: `npm test -- nodeStatuses.test.ts`
Expected: PASS

- [ ] **Step 10: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 11: Commit**

```bash
git add src/canvas/types.ts src/training/useTrainingRun.ts src/training/nodeStatuses.ts tests/useTrainingRun.test.ts tests/nodeStatuses.test.ts
git commit -m "frontend: add NodeRunStatus type, node_error nodeId, and nodeStatuses helper"
```

---

## Task 5: Canvas node-status glow + animated edges

Wires `NodeRunStatus` into `PipelineCanvas` rendering: nodes get a status
CSS class, edges feeding a `running` node get React Flow's built-in
`animated` treatment. The `nodeStatuses` prop is optional (defaults to
`{}`), so `App.tsx` does not need to change in this task — it's wired in
Task 9.

**Files:**
- Modify: `apps/frontend/src/canvas/PipelineCanvas.tsx`
- Test: Modify `apps/frontend/tests/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `NodeRunStatus` from `./types` (Task 4).
- Produces: `PipelineCanvasProps` gains optional
  `nodeStatuses?: Record<string, NodeRunStatus>` — Task 9's `App.tsx` passes
  this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/PipelineCanvas.test.tsx` (new `describe` block at the end of
the file):

```tsx
describe('PipelineCanvas node status', () => {
  it('applies a status class to a node based on the nodeStatuses map', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
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
        nodeStatuses={{ n1: 'running' }}
      />,
    )

    expect(container.querySelector('.pipeline-node-running')).not.toBeNull()
  })

  it('defaults an unlisted node to the idle status class', () => {
    vi.mocked(client.useNodes).mockReturnValue({
      data: [csvManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: csvManifest, params: {} },
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

    expect(container.querySelector('.pipeline-node-idle')).not.toBeNull()
  })

  it('marks an edge animated when its target node is running', async () => {
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
    const edge: PipelineEdge = { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'table', targetHandle: 'table' }

    const { container } = render(
      <PipelineCanvas
        nodes={[nodeA, nodeB]}
        edges={[edge]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
        nodeStatuses={{ n2: 'running' }}
      />,
    )

    await screen.findByRole('button', { name: /delete connection/i })

    expect(container.querySelector('.react-flow__edge.animated')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- PipelineCanvas.test.tsx`
Expected: FAIL — `nodeStatuses` prop doesn't exist, no status classes
applied.

- [ ] **Step 3: Wire `nodeStatuses` into `PipelineCanvas.tsx`**

Modify `src/canvas/PipelineCanvas.tsx`:

Add `useMemo` to the React import:

```ts
import { useCallback, useMemo, useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
```

Import `NodeRunStatus` alongside the existing type imports:

```ts
import type { NodeRunStatus, PipelineEdge, PipelineNode, PipelineNodeData } from './types'
```

Change `PipelineNodeRenderer` to read and apply the status class — replace:

```tsx
function PipelineNodeRenderer({ id, data }: NodeProps<PipelineNode>) {
  const { manifest } = data as PipelineNodeData
  const { deleteElements } = useReactFlow()
  const portRows = Math.max(manifest.inputs.length, manifest.outputs.length, 1)
  const minHeight = PORT_TOP_OFFSET + portRows * PORT_ROW_HEIGHT + NODE_MIN_HEIGHT_PADDING
  return (
    <div className="pipeline-node" style={{ minHeight }}>
```

with:

```tsx
function PipelineNodeRenderer({ id, data }: NodeProps<PipelineNode>) {
  const { manifest, status = 'idle' } = data as PipelineNodeData
  const { deleteElements } = useReactFlow()
  const portRows = Math.max(manifest.inputs.length, manifest.outputs.length, 1)
  const minHeight = PORT_TOP_OFFSET + portRows * PORT_ROW_HEIGHT + NODE_MIN_HEIGHT_PADDING
  return (
    <div className={`pipeline-node pipeline-node-${status}`} style={{ minHeight }}>
```

Add `nodeStatuses` to `PipelineCanvasProps`:

```ts
export interface PipelineCanvasProps {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  onNodesChange: OnNodesChange<PipelineNode>
  onEdgesChange: OnEdgesChange<PipelineEdge>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setEdges: Dispatch<SetStateAction<PipelineEdge[]>>
  onSelectNode: (nodeId: string | null) => void
  nodeStatuses?: Record<string, NodeRunStatus>
}
```

Destructure it (with a default) in `PipelineCanvasInner`, and compute
display nodes/edges — change:

```tsx
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
```

to:

```tsx
function PipelineCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  nodeStatuses = {},
}: PipelineCanvasProps) {
  const { data: manifests } = useNodes()
  const { screenToFlowPosition } = useReactFlow()
  const nodeIdCounter = useRef(0)

  const displayNodes = useMemo(
    () => nodes.map((node) => ({ ...node, data: { ...node.data, status: nodeStatuses[node.id] ?? 'idle' } })),
    [nodes, nodeStatuses],
  )
  const displayEdges = useMemo(
    () => edges.map((edge) => ({ ...edge, animated: nodeStatuses[edge.target] === 'running' })),
    [edges, nodeStatuses],
  )
```

Finally, change the `<ReactFlow>` element's `nodes`/`edges` props from
`nodes={nodes}` / `edges={edges}` to `nodes={displayNodes}` /
`edges={displayEdges}`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- PipelineCanvas.test.tsx`
Expected: PASS (all cases, including the pre-existing ones — `displayNodes`/
`displayEdges` preserve every other field via spread).

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/PipelineCanvas.tsx tests/PipelineCanvas.test.tsx
git commit -m "frontend: add per-node run-status glow and animated edges to the canvas"
```

---

## Task 6: `PreviewPanel` → tab content; add `OutputPanel`; wire into `App`

Reworks `PreviewPanel` to drop its modal-close chrome (it becomes tab
content, always mounted), adds `OutputPanel` (Results / Data Preview tabs),
and wires it into `App.tsx` in place of the header metrics banner and the
fixed-position preview drawer. The final 4-zone layout doesn't exist yet
(Task 8) — `OutputPanel` renders directly below `.app-body` for now; Task 9
moves it into the new layout.

**Files:**
- Modify: `apps/frontend/src/preview/PreviewPanel.tsx`
- Test: Modify `apps/frontend/tests/PreviewPanel.test.tsx`
- Create: `apps/frontend/src/output/OutputPanel.tsx`
- Test: Create `apps/frontend/tests/OutputPanel.test.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Test: Modify `apps/frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: `MetricsSummary` from `../metrics/MetricsSummary` (Task 2);
  `PreviewState` from `./usePreview` (existing).
- Produces: `OutputTab = 'results' | 'preview'` and
  `OutputPanel({ activeTab, onTabChange, runMetrics, runError, previewState
  }: OutputPanelProps)` from `output/OutputPanel.tsx` — Task 9's `App.tsx`
  imports both.

- [ ] **Step 1: Update the failing `PreviewPanel` tests**

Modify `tests/PreviewPanel.test.tsx` — replace the whole file:

```tsx
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- PreviewPanel.test.tsx`
Expected: FAIL — `PreviewPanel` still requires `onClose` and doesn't handle
`idle` with the new message.

- [ ] **Step 3: Rework `PreviewPanel.tsx`**

Replace `src/preview/PreviewPanel.tsx` entirely:

```tsx
import type { PreviewState } from './usePreview'

export interface PreviewPanelProps {
  state: PreviewState
}

export function PreviewPanel({ state }: PreviewPanelProps) {
  return (
    <div className="preview-panel">
      {state.status === 'idle' && (
        <p className="output-panel-empty">Select "Preview Output" on a node to see its data here.</p>
      )}
      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'error' && <p className="error-banner">{state.error}</p>}
      {state.status === 'success' && (
        <>
          <div className="preview-table-scroll">
            <table className="preview-table">
              <thead>
                <tr>
                  {state.data.columns.map((col) => (
                    <th key={col.name}>
                      {col.name}
                      <div className="preview-table-dtype">{col.dtype}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="preview-table-footer">
            Showing {state.data.rows.length} of {state.data.total_rows.toLocaleString()} rows
          </p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the `PreviewPanel` tests to confirm they pass**

Run: `npm test -- PreviewPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `OutputPanel` tests**

Create `tests/OutputPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutputPanel } from '../src/output/OutputPanel'

describe('OutputPanel', () => {
  it('shows the empty-results message on the Results tab when there is no run data yet', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('Run the pipeline to see results here.')).toBeInTheDocument()
  })

  it('renders run metrics on the Results tab', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={{ 'n4.metrics': { accuracy: 0.95 } }}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
  })

  it('renders the run error on the Results tab', () => {
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError="unknown node type"
        previewState={{ status: 'idle' }}
      />,
    )

    expect(screen.getByText('unknown node type')).toBeInTheDocument()
  })

  it('renders the preview panel on the Data Preview tab', () => {
    render(
      <OutputPanel
        activeTab="preview"
        onTabChange={vi.fn()}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'loading' }}
      />,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('calls onTabChange when a tab button is clicked', async () => {
    const onTabChange = vi.fn()
    render(
      <OutputPanel
        activeTab="results"
        onTabChange={onTabChange}
        runMetrics={undefined}
        runError={null}
        previewState={{ status: 'idle' }}
      />,
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Data Preview' }))

    expect(onTabChange).toHaveBeenCalledWith('preview')
  })
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- OutputPanel.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Create `OutputPanel.tsx`**

Create `src/output/OutputPanel.tsx`:

```tsx
import { MetricsSummary } from '../metrics/MetricsSummary'
import { PreviewPanel } from '../preview/PreviewPanel'
import type { PreviewState } from '../preview/usePreview'

export type OutputTab = 'results' | 'preview'

export interface OutputPanelProps {
  activeTab: OutputTab
  onTabChange: (tab: OutputTab) => void
  runMetrics: Record<string, unknown> | undefined
  runError: string | null
  previewState: PreviewState
}

export function OutputPanel({ activeTab, onTabChange, runMetrics, runError, previewState }: OutputPanelProps) {
  return (
    <div className="output-panel">
      <div className="output-panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'results'}
          className={activeTab === 'results' ? 'output-tab output-tab-active' : 'output-tab'}
          onClick={() => onTabChange('results')}
        >
          Results
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          className={activeTab === 'preview' ? 'output-tab output-tab-active' : 'output-tab'}
          onClick={() => onTabChange('preview')}
        >
          Data Preview
        </button>
      </div>
      <div className="output-panel-content">
        {activeTab === 'results' && (
          <>
            {runError && <p className="error-banner">{runError}</p>}
            {runMetrics && (
              <div className="metrics-list">
                {Object.entries(runMetrics).map(([ref, value]) => (
                  <div key={ref} className="metrics-block">
                    <h3 className="metrics-block-heading">{ref}</h3>
                    <MetricsSummary metrics={value as Record<string, unknown>} />
                  </div>
                ))}
              </div>
            )}
            {!runError && !runMetrics && <p className="output-panel-empty">Run the pipeline to see results here.</p>}
          </>
        )}
        {activeTab === 'preview' && <PreviewPanel state={previewState} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run the `OutputPanel` tests to confirm they pass**

Run: `npm test -- OutputPanel.test.tsx`
Expected: PASS

- [ ] **Step 9: Wire `OutputPanel` into `App.tsx`**

Modify `src/App.tsx`:

Change the imports — remove
`import { MetricsView } from './metrics/MetricsView'` (already renamed in
Task 2 to `MetricsSummary`; it's no longer used directly by `App`, only by
`OutputPanel`) and `import { PreviewPanel } from './preview/PreviewPanel'`,
add `import { OutputPanel, type OutputTab } from './output/OutputPanel'`.
The import block becomes:

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
import { OutputPanel, type OutputTab } from './output/OutputPanel'
import { usePreview } from './preview/usePreview'
import { TrainingMonitor } from './training/TrainingMonitor'
```

Replace the `previewTarget`/`handleClosePreview` state and handler with an
`outputTab` state, and update `handlePreview` — change:

```tsx
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ nodeId: string; port: string } | null>(null)
  const preview = usePreview()
```

to:

```tsx
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [outputTab, setOutputTab] = useState<OutputTab>('results')
  const preview = usePreview()
```

and change:

```tsx
  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setPreviewTarget({ nodeId, port })
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const handleClosePreview = useCallback(() => {
    setPreviewTarget(null)
    preview.reset()
  }, [preview])
```

to:

```tsx
  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setOutputTab('preview')
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )
```

Replace the header metrics banner and the fixed preview drawer in the JSX —
change:

```tsx
      {runMutation.error && <p className="error-banner">{runMutation.error.message}</p>}
      {runMutation.data?.kind === 'sync' && (
        <div className="metrics-list">
          {Object.entries(runMutation.data.metrics).map(([ref, value]) => (
            <div key={ref} className="metrics-block">
              <h3 className="metrics-block-heading">{ref}</h3>
              <MetricsSummary metrics={value as Record<string, unknown>} />
            </div>
          ))}
        </div>
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
        <InspectorPanel
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          onParamChange={handleParamChange}
          onPreview={handlePreview}
        />
      </div>

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
      {activeRunId && <TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />}
      {previewTarget && <PreviewPanel state={preview.state} onClose={handleClosePreview} />}
    </div>
  )
}
```

to:

```tsx
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
        <InspectorPanel
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          onParamChange={handleParamChange}
          onPreview={handlePreview}
        />
      </div>

      <OutputPanel
        activeTab={outputTab}
        onTabChange={setOutputTab}
        runMetrics={runMutation.data?.kind === 'sync' ? runMutation.data.metrics : undefined}
        runError={runMutation.error?.message ?? null}
        previewState={preview.state}
      />

      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
      {activeRunId && <TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />}
    </div>
  )
}
```

(`TrainingMonitor` stays wired exactly as before — it's removed in Task 9.)

- [ ] **Step 10: Update `App.test.tsx`'s preview test**

Modify `tests/App.test.tsx`: remove the
`vi.mock('../src/preview/PreviewPanel', ...)` block entirely (the real
`PreviewPanel`, nested inside the real `OutputPanel`, is now used). Replace
the last test — `'opens and closes the preview panel when Preview is
triggered from the inspector'` — with:

```tsx
  it('switches to the Data Preview tab and shows preview data when Preview is triggered from the inspector', async () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))

    expect(await screen.findByText('Showing 0 of 0 rows')).toBeInTheDocument()
  })
```

- [ ] **Step 11: Run the full suite and build**

Run: `npm test && npm run build`
Expected: both pass. (The sync-metrics test is unaffected — `OutputPanel`'s
Results tab is active by default and renders the same `MetricsSummary`
output the header banner used to.)

- [ ] **Step 12: Commit**

```bash
git add src/preview/PreviewPanel.tsx src/output/OutputPanel.tsx src/App.tsx tests/PreviewPanel.test.tsx tests/OutputPanel.test.tsx tests/App.test.tsx
git commit -m "frontend: rework PreviewPanel as tab content, add OutputPanel, wire into App"
```

---

## Task 7: `histogram.ts` + `VisualizationsPanel`

Builds the Visualizations panel: metrics charts (via Task 3's
`MetricsCharts`), data-distribution histograms computed client-side from
preview data, and a live training curve. Not wired into `App.tsx` yet —
that's Task 9.

**Files:**
- Create: `apps/frontend/src/visualizations/histogram.ts`
- Test: `apps/frontend/tests/histogram.test.ts`
- Create: `apps/frontend/src/visualizations/VisualizationsPanel.tsx`
- Test: `apps/frontend/tests/VisualizationsPanel.test.tsx`

**Interfaces:**
- Consumes: `PreviewResult` from `../api/types` (existing);
  `extractConfusionMatrix`, `extractRocCurve` from `../metrics/metricsHelpers`
  (Task 2); `MetricsCharts` from `./MetricsCharts` (Task 3); `TrainingState`
  from `../training/useTrainingRun` (existing).
- Produces: `computeHistograms(data: PreviewResult, binCount?: number):
  ColumnHistogram[]` from `visualizations/histogram.ts`.
  `VisualizationsPanel({ runMetrics, previewData, trainingState }:
  VisualizationsPanelProps)` from `visualizations/VisualizationsPanel.tsx` —
  Task 9's `App.tsx` imports this.

- [ ] **Step 1: Write the failing `histogram` test**

Create `tests/histogram.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeHistograms } from '../src/visualizations/histogram'

describe('computeHistograms', () => {
  it('bins numeric columns and skips non-numeric ones', () => {
    const result = computeHistograms(
      {
        columns: [
          { name: 'age', dtype: 'int64' },
          { name: 'label', dtype: 'object' },
        ],
        rows: [
          [0, 'a'],
          [50, 'b'],
          [100, 'a'],
        ],
        total_rows: 3,
      },
      2,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.column).toBe('age')
    expect(result[0]?.bins).toHaveLength(2)
    expect(result[0]?.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3)
  })

  it('returns an empty array when there are no numeric columns', () => {
    const result = computeHistograms({
      columns: [{ name: 'label', dtype: 'object' }],
      rows: [['a']],
      total_rows: 1,
    })

    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- histogram.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `histogram.ts`**

Create `src/visualizations/histogram.ts`:

```ts
import type { PreviewResult } from '../api/types'

export interface HistogramBin {
  bin: string
  count: number
}

export interface ColumnHistogram {
  column: string
  bins: HistogramBin[]
}

const NUMERIC_DTYPES = new Set(['int64', 'int32', 'float64', 'float32'])
const DEFAULT_BIN_COUNT = 10

export function computeHistograms(data: PreviewResult, binCount = DEFAULT_BIN_COUNT): ColumnHistogram[] {
  const numericColumns = data.columns
    .map((column, index) => ({ ...column, index }))
    .filter((column) => NUMERIC_DTYPES.has(column.dtype))

  return numericColumns.map((column) => {
    const values = data.rows
      .map((row) => row[column.index])
      .filter((value): value is number => typeof value === 'number')

    if (values.length === 0) {
      return { column: column.name, bins: [] }
    }

    const min = Math.min(...values)
    const max = Math.max(...values)
    const width = (max - min || 1) / binCount
    const counts = new Array(binCount).fill(0) as number[]
    for (const value of values) {
      const index = Math.min(binCount - 1, Math.floor((value - min) / width))
      counts[index] += 1
    }

    return {
      column: column.name,
      bins: counts.map((count, i) => ({
        bin: `${(min + i * width).toFixed(1)}–${(min + (i + 1) * width).toFixed(1)}`,
        count,
      })),
    }
  })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- histogram.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing `VisualizationsPanel` tests**

Create `tests/VisualizationsPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VisualizationsPanel } from '../src/visualizations/VisualizationsPanel'

describe('VisualizationsPanel', () => {
  it('shows an empty-state message when there is nothing to chart', () => {
    render(<VisualizationsPanel runMetrics={undefined} previewData={undefined} trainingState={undefined} />)
    expect(screen.getByText('Run the pipeline or preview data to see charts here.')).toBeInTheDocument()
  })

  it('renders a metrics chart section when run metrics contain a confusion matrix', () => {
    render(
      <VisualizationsPanel
        runMetrics={{
          'n4.metrics': {
            confusion_matrix: [
              [1, 0],
              [0, 1],
            ],
            labels: [0, 1],
          },
        }}
        previewData={undefined}
        trainingState={undefined}
      />,
    )
    expect(screen.getByText('n4.metrics')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('skips a metrics entry that has no chartable shape', () => {
    render(
      <VisualizationsPanel
        runMetrics={{ 'n4.metrics': { accuracy: 0.9 } }}
        previewData={undefined}
        trainingState={undefined}
      />,
    )
    expect(screen.queryByText('n4.metrics')).not.toBeInTheDocument()
  })

  it('renders a histogram section per numeric column when preview data is present', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={{
          columns: [
            { name: 'age', dtype: 'int64' },
            { name: 'label', dtype: 'object' },
          ],
          rows: [
            [20, 'a'],
            [30, 'b'],
            [40, 'a'],
          ],
          total_rows: 3,
        }}
        trainingState={undefined}
      />,
    )
    expect(screen.getByText('age distribution')).toBeInTheDocument()
    expect(screen.queryByText('label distribution')).not.toBeInTheDocument()
  })

  it('renders a training curve section with a status heading while a run is in progress', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={undefined}
        trainingState={{
          status: 'running',
          history: [{ event: 'progress', node_id: 'n5', epoch: 1, loss: 0.5, val_loss: 0.6 }],
        }}
      />,
    )
    expect(screen.getByText('Training…')).toBeInTheDocument()
  })

  it('shows "Training complete" once the run finishes', () => {
    render(
      <VisualizationsPanel
        runMetrics={undefined}
        previewData={undefined}
        trainingState={{ status: 'complete', history: [], metrics: {} }}
      />,
    )
    expect(screen.getByText('Training complete')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- VisualizationsPanel.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Create `VisualizationsPanel.tsx`**

Create `src/visualizations/VisualizationsPanel.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { PreviewResult } from '../api/types'
import { extractConfusionMatrix, extractRocCurve } from '../metrics/metricsHelpers'
import type { TrainingState } from '../training/useTrainingRun'
import { computeHistograms } from './histogram'
import { MetricsCharts } from './MetricsCharts'

export interface VisualizationsPanelProps {
  runMetrics: Record<string, unknown> | undefined
  previewData: PreviewResult | undefined
  trainingState: TrainingState | undefined
}

const CHART_WIDTH = 280
const CHART_HEIGHT = 200

function trainingStatusLabel(status: TrainingState['status']): string {
  if (status === 'complete') return 'Training complete'
  if (status === 'error') return 'Training failed'
  return 'Training…'
}

export function VisualizationsPanel({ runMetrics, previewData, trainingState }: VisualizationsPanelProps) {
  const histograms = previewData ? computeHistograms(previewData) : []
  const chartableMetricsEntries = runMetrics
    ? Object.entries(runMetrics).filter(([, value]) => {
        const metrics = value as Record<string, unknown>
        return Boolean(extractConfusionMatrix(metrics) || extractRocCurve(metrics))
      })
    : []
  const showEmpty = chartableMetricsEntries.length === 0 && histograms.length === 0 && !trainingState

  return (
    <div className="visualizations-panel">
      {trainingState && (
        <section className="visualizations-section">
          <h3 className="visualizations-section-heading">{trainingStatusLabel(trainingState.status)}</h3>
          <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={trainingState.history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="epoch" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="loss" name="Loss" stroke="var(--color-accent)" dot={false} />
            <Line
              type="monotone"
              dataKey="val_loss"
              name="Validation Loss"
              stroke="var(--color-warning)"
              dot={false}
            />
          </LineChart>
        </section>
      )}

      {chartableMetricsEntries.map(([ref, value]) => (
        <section className="visualizations-section" key={ref}>
          <h3 className="visualizations-section-heading">{ref}</h3>
          <MetricsCharts metrics={value as Record<string, unknown>} />
        </section>
      ))}

      {histograms.map((histogram) => (
        <section className="visualizations-section" key={histogram.column}>
          <h3 className="visualizations-section-heading">{histogram.column} distribution</h3>
          <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={histogram.bins}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bin" tick={false} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="var(--color-accent)" />
          </BarChart>
        </section>
      ))}

      {showEmpty && <p className="output-panel-empty">Run the pipeline or preview data to see charts here.</p>}
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `npm test -- VisualizationsPanel.test.tsx`
Expected: PASS

- [ ] **Step 9: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add src/visualizations/histogram.ts src/visualizations/VisualizationsPanel.tsx tests/histogram.test.ts tests/VisualizationsPanel.test.tsx
git commit -m "frontend: add data-distribution histograms and VisualizationsPanel"
```

---

## Task 8: Resizable layout primitives — `AppLayout` / `TopRow` / `BottomRow`

Builds the four-zone resizable layout shell using `react-resizable-panels`.
Not wired into `App.tsx` yet — that's Task 9.

**Files:**
- Create: `apps/frontend/src/layout/TopRow.tsx`
- Create: `apps/frontend/src/layout/BottomRow.tsx`
- Create: `apps/frontend/src/layout/AppLayout.tsx`
- Test: `apps/frontend/tests/AppLayout.test.tsx`

**Interfaces:**
- Produces: `AppLayout({ palette, canvas, inspector, output, visualizations
  }: AppLayoutProps)` from `layout/AppLayout.tsx` — Task 9's `App.tsx`
  imports this.

- [ ] **Step 1: Write the failing test**

Create `tests/AppLayout.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppLayout } from '../src/layout/AppLayout'

describe('AppLayout', () => {
  it('renders all five zones', () => {
    render(
      <AppLayout
        palette={<div>Palette content</div>}
        canvas={<div>Canvas content</div>}
        inspector={<div>Inspector content</div>}
        output={<div>Output content</div>}
        visualizations={<div>Visualizations content</div>}
      />,
    )

    expect(screen.getByText('Palette content')).toBeInTheDocument()
    expect(screen.getByText('Canvas content')).toBeInTheDocument()
    expect(screen.getByText('Inspector content')).toBeInTheDocument()
    expect(screen.getByText('Output content')).toBeInTheDocument()
    expect(screen.getByText('Visualizations content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- AppLayout.test.tsx`
Expected: FAIL — none of the three modules exist yet.

- [ ] **Step 3: Create `TopRow.tsx`**

Create `src/layout/TopRow.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export interface TopRowProps {
  palette: ReactNode
  canvas: ReactNode
  inspector: ReactNode
}

export function TopRow({ palette, canvas, inspector }: TopRowProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="vmb-layout-top">
      <Panel id="palette" defaultSize={15} minSize={10} className="layout-panel">
        {palette}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="canvas" defaultSize={60} minSize={30} className="layout-panel layout-panel-canvas">
        {canvas}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="inspector" defaultSize={25} minSize={15} className="layout-panel">
        {inspector}
      </Panel>
    </PanelGroup>
  )
}
```

- [ ] **Step 4: Create `BottomRow.tsx`**

Create `src/layout/BottomRow.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export interface BottomRowProps {
  output: ReactNode
  visualizations: ReactNode
}

export function BottomRow({ output, visualizations }: BottomRowProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="vmb-layout-bottom">
      <Panel id="output" defaultSize={50} minSize={20} className="layout-panel">
        {output}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="visualizations" defaultSize={50} minSize={20} className="layout-panel">
        {visualizations}
      </Panel>
    </PanelGroup>
  )
}
```

- [ ] **Step 5: Create `AppLayout.tsx`**

Create `src/layout/AppLayout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { BottomRow } from './BottomRow'
import { TopRow } from './TopRow'

export interface AppLayoutProps {
  palette: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  output: ReactNode
  visualizations: ReactNode
}

export function AppLayout({ palette, canvas, inspector, output, visualizations }: AppLayoutProps) {
  return (
    <div className="app-body">
      <PanelGroup direction="vertical" autoSaveId="vmb-layout-outer">
        <Panel id="top" defaultSize={65} minSize={30}>
          <TopRow palette={palette} canvas={canvas} inspector={inspector} />
        </Panel>
        <PanelResizeHandle className="layout-resize-handle layout-resize-handle-horizontal" />
        <Panel id="bottom" defaultSize={35} minSize={15}>
          <BottomRow output={output} visualizations={visualizations} />
        </Panel>
      </PanelGroup>
    </div>
  )
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npm test -- AppLayout.test.tsx`
Expected: PASS. (`tests/setup.ts` already polyfills `ResizeObserver` for
React Flow, which `react-resizable-panels` also relies on; children render
using each `Panel`'s `defaultSize` regardless of measured pixel dimensions.)

- [ ] **Step 7: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/layout/TopRow.tsx src/layout/BottomRow.tsx src/layout/AppLayout.tsx tests/AppLayout.test.tsx
git commit -m "frontend: add resizable AppLayout/TopRow/BottomRow layout primitives"
```

---

## Task 9: Wire everything into `App.tsx`; remove `TrainingMonitor`

The integration task: replaces `App.tsx`'s flat `.app-body` structure with
`AppLayout`, moves `OutputPanel` into the layout's `output` slot, wires
`VisualizationsPanel` into the `visualizations` slot, wires per-node
`nodeStatuses` into `PipelineCanvas`, derives an `isRunning` state driving
the Run button, and removes the full-screen `TrainingMonitor` modal (its
content now lives in `VisualizationsPanel`, wired in Task 7).

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Delete: `apps/frontend/src/training/TrainingMonitor.tsx`
- Delete: `apps/frontend/tests/TrainingMonitor.test.tsx`
- Test: Modify `apps/frontend/tests/App.test.tsx`
- Test: Verify (no changes expected) `apps/frontend/tests/App.integration.test.tsx`

**Interfaces:**
- Consumes: `AppLayout` (Task 8), `OutputPanel`/`OutputTab` (Task 6),
  `VisualizationsPanel` (Task 7), `nodeStatusesFromTrainingState` (Task 4),
  `PipelineCanvas`'s `nodeStatuses` prop (Task 5).

- [ ] **Step 1: Update `App.test.tsx`'s training-related mocks and test**

Modify `tests/App.test.tsx`:

Remove the `vi.mock('../src/training/TrainingMonitor', ...)` block. Add, in
its place:

```tsx
vi.mock('../src/training/useTrainingRun', async () => {
  const actual = await vi.importActual<typeof import('../src/training/useTrainingRun')>(
    '../src/training/useTrainingRun',
  )
  return { ...actual, useTrainingRun: vi.fn() }
})
```

Add the import it needs, alongside the existing `import * as client from
'../src/api/client'`:

```tsx
import * as trainingRun from '../src/training/useTrainingRun'
```

In the `beforeEach`, add a default mock return value:

```tsx
  beforeEach(() => {
    vi.mocked(client.useNodes).mockReturnValue({ data: [], isLoading: false, error: null } as ReturnType<
      typeof client.useNodes
    >)
    vi.mocked(trainingRun.useTrainingRun).mockReturnValue({ status: 'connecting', history: [] })
  })
```

Replace the test `'opens the training monitor when the run mutation returns
an async outcome'` with:

```tsx
  it('shows a "Running…" state and a training heading in the visualizations panel when the run mutation returns an async outcome', async () => {
    const runMutate = vi.fn(
      (_ir, options?: { onSuccess?: (outcome: { kind: 'async'; runId: string }) => void }) =>
        options?.onSuccess?.({ kind: 'async', runId: 'run-1' }),
    )
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({ mutate: runMutate }))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }))

    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
    expect(screen.getByText('Training…')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- App.test.tsx`
Expected: FAIL — `App.tsx` still renders `TrainingMonitor`, not
`VisualizationsPanel`; the Run button still reads `runMutation.isPending`
only.

- [ ] **Step 3: Rewrite `App.tsx`**

Replace `src/App.tsx` entirely:

```tsx
import { useCallback, useMemo, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { useGetCode, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { toIR } from './ir/convert'
import { AppLayout } from './layout/AppLayout'
import { NodePalette } from './palette/NodePalette'
import { OutputPanel, type OutputTab } from './output/OutputPanel'
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
  const preview = usePreview()
  const trainingState = useTrainingRun(activeRunId)

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

  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setOutputTab('preview')
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const nodeStatuses = useMemo(
    () => (activeRunId ? nodeStatusesFromTrainingState(trainingState) : {}),
    [activeRunId, trainingState],
  )

  const isRunning =
    runMutation.isPending ||
    (activeRunId !== null && (trainingState.status === 'connecting' || trainingState.status === 'running'))

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Visual Model Builder</h1>
        <button type="button" className={isRunning ? 'is-running' : undefined} onClick={handleRun} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={handleViewCode} disabled={codeMutation.isPending}>
          {codeMutation.isPending ? 'Generating…' : 'View Code'}
        </button>
      </header>

      <AppLayout
        palette={<NodePalette />}
        canvas={
          <PipelineCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
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
            runMetrics={runMutation.data?.kind === 'sync' ? runMutation.data.metrics : undefined}
            runError={runMutation.error?.message ?? null}
            previewState={preview.state}
          />
        }
        visualizations={
          <VisualizationsPanel
            runMetrics={runMutation.data?.kind === 'sync' ? runMutation.data.metrics : undefined}
            previewData={preview.state.status === 'success' ? preview.state.data : undefined}
            trainingState={activeRunId ? trainingState : undefined}
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

- [ ] **Step 4: Delete `TrainingMonitor` and its test**

```bash
git rm src/training/TrainingMonitor.tsx tests/TrainingMonitor.test.tsx
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, including `App.integration.test.tsx` unchanged — its async
run assertion (`waitFor(() => screen.getByText('Training…'))`) is now
satisfied by `VisualizationsPanel`'s training-status heading instead of the
deleted `TrainingMonitor` modal; the WebSocket-URL assertion is unaffected
since `useTrainingRun` itself didn't change how it connects.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS — no remaining references to `TrainingMonitor` or the
deleted `previewTarget`/`handleClosePreview`.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx tests/App.test.tsx
git commit -m "frontend: wire AppLayout/OutputPanel/VisualizationsPanel into App, remove TrainingMonitor modal"
```

---

## Task 10: Design-system CSS pass

Rewrites `index.css` against the tokens from Task 1, styles every new
component (`layout-*`, `output-*`, `visualizations-*`), adds the node
status glow keyframes and Run-button spinner, and switches React Flow's
canvas chrome to its built-in dark preset.

**Files:**
- Modify: `apps/frontend/src/canvas/PipelineCanvas.tsx` (one-line
  `colorMode` prop)
- Modify: `apps/frontend/src/index.css` (full rewrite)

**Interfaces:** None — this task is pure styling; it introduces no new
exports and changes no component signatures.

- [ ] **Step 1: Enable React Flow's built-in dark theme**

Modify `src/canvas/PipelineCanvas.tsx` — in `PipelineCanvasInner`'s
returned JSX, add `colorMode="dark"` to the `<ReactFlow>` element:

```tsx
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={(connection) => validateConnection(connection, nodes)}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={{ type: 'deleteable' }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        colorMode="dark"
        fitView
      >
```

- [ ] **Step 2: Replace `index.css`**

Replace `src/index.css` entirely:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-ui);
  background: var(--color-bg-canvas);
  color: var(--color-text-primary);
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
}

.app-header h1 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  margin-right: var(--space-2);
}

.app-header button {
  font-family: var(--font-ui);
  font-size: 13px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.app-header button:hover:not(:disabled) {
  opacity: 0.85;
}

.app-header button:disabled {
  opacity: 0.6;
  cursor: default;
}

@keyframes button-spin {
  to {
    transform: rotate(360deg);
  }
}

.app-header button.is-running::before {
  content: '';
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: var(--space-1);
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: button-spin 0.6s linear infinite;
  vertical-align: -1px;
}

.error-banner {
  color: var(--color-error);
  padding: var(--space-1) 0;
  margin: 0;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.layout-panel {
  height: 100%;
  overflow: auto;
  background: var(--color-bg-panel);
}

.layout-panel-canvas {
  background: var(--color-bg-canvas);
  overflow: hidden;
}

.layout-resize-handle {
  background: var(--color-border);
  transition: background 0.15s ease;
}

.layout-resize-handle:hover,
.layout-resize-handle[data-resize-handle-active] {
  background: var(--color-accent);
}

[data-panel-group-direction='horizontal'] > .layout-resize-handle {
  width: 4px;
  cursor: col-resize;
}

[data-panel-group-direction='vertical'] > .layout-resize-handle {
  height: 4px;
  cursor: row-resize;
}

.node-palette {
  padding: var(--space-2);
}

.node-palette h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  margin: var(--space-3) 0 var(--space-1);
}

.node-palette-item {
  padding: var(--space-2);
  margin: var(--space-1) 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  cursor: grab;
  font-size: 13px;
}

.pipeline-canvas {
  width: 100%;
  height: 100%;
}

.pipeline-node {
  position: relative;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  min-width: 140px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

@keyframes node-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--color-accent);
  }
  50% {
    box-shadow: 0 0 12px 4px var(--color-accent);
  }
}

.pipeline-node-running {
  border-color: var(--color-accent);
  animation: node-pulse 1.4s ease-in-out infinite;
}

.pipeline-node-success {
  border-color: var(--color-success);
  box-shadow: 0 0 8px 2px var(--color-success);
}

.pipeline-node-error {
  border-color: var(--color-error);
  box-shadow: 0 0 8px 2px var(--color-error);
}

.pipeline-node-port-label {
  position: absolute;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  pointer-events: none;
}

.pipeline-node-port-label-target {
  left: 10px;
}

.pipeline-node-port-label-source {
  right: 10px;
}

.node-delete-button,
.edge-delete-button {
  width: 18px;
  height: 18px;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.node-delete-button {
  position: absolute;
  top: -8px;
  right: -8px;
}

.node-delete-button:hover,
.edge-delete-button:hover {
  background: var(--color-bg-panel);
  color: var(--color-error);
  border-color: var(--color-error);
}

.inspector-panel {
  padding: var(--space-2);
}

.inspector-panel h2 {
  font-size: 14px;
  margin: 0 0 var(--space-2);
}

.inspector-preview-buttons {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.inspector-preview-buttons button {
  font-family: var(--font-ui);
  font-size: 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  cursor: pointer;
}

.param-control {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--color-text-primary);
}

.param-control-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}

.param-control-with-hint {
  margin-bottom: var(--space-2);
}

.param-control-with-hint .param-control {
  margin-bottom: 2px;
}

.param-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.param-hint-error {
  color: var(--color-error);
}

.output-panel,
.visualizations-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.output-panel-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--color-border);
  flex: none;
}

.output-tab {
  font-family: var(--font-ui);
  font-size: 13px;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.output-tab:hover {
  color: var(--color-text-primary);
}

.output-tab-active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent);
}

@keyframes panel-fade-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.output-panel-content {
  padding: var(--space-3);
  overflow: auto;
  flex: 1;
  min-height: 0;
  animation: panel-fade-in 0.15s ease;
}

.output-panel-empty {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.visualizations-panel {
  padding: var(--space-3);
  overflow: auto;
  gap: var(--space-4);
}

.visualizations-section {
  margin-bottom: var(--space-4);
}

.visualizations-section-heading {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-2);
}

.preview-panel {
  color: var(--color-text-primary);
}

.preview-table-scroll {
  overflow-x: auto;
}

.preview-table {
  border-collapse: collapse;
  width: 100%;
}

.preview-table th,
.preview-table td {
  border: 1px solid var(--color-border);
  padding: var(--space-1) var(--space-2);
  text-align: left;
  white-space: nowrap;
}

.preview-table-dtype {
  font-size: 10px;
  font-weight: normal;
  color: var(--color-text-secondary);
}

.preview-table-footer {
  margin-top: var(--space-2);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.metrics-block {
  margin-bottom: var(--space-4);
}

.metrics-block-heading {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-1);
}

.metrics-view {
  margin: 0;
}

.metrics-stat {
  display: flex;
  gap: var(--space-2);
  padding: 2px 0;
}

.metrics-stat dt {
  font-weight: 600;
}

.metrics-stat dd {
  margin: 0;
}

.metrics-charts {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.confusion-matrix-table {
  border-collapse: collapse;
  margin-bottom: var(--space-2);
}

.confusion-matrix-table th,
.confusion-matrix-table td {
  border: 1px solid var(--color-border);
  padding: var(--space-1) var(--space-2);
  text-align: center;
}

.confusion-matrix-diagonal {
  background: rgba(62, 207, 142, 0.18);
  font-weight: 600;
}

.metrics-fallback {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}

.modal-panel {
  position: fixed;
  inset: 0;
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
  overflow: auto;
  padding: var(--space-4);
  box-shadow: var(--shadow-elevated);
  z-index: 10;
}

.modal-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-panel-header button {
  font-family: var(--font-ui);
  font-size: 13px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
}
```

- [ ] **Step 3: Full suite + build**

Run: `npm test && npm run build`
Expected: both pass. (CSS changes don't affect jsdom-based Testing Library
assertions, which query by text/role, not computed style.)

- [ ] **Step 4: Commit**

```bash
git add src/canvas/PipelineCanvas.tsx src/index.css
git commit -m "frontend: dark token-based redesign — layout, panels, node glow, canvas theme"
```

---

## Task 11: Manual QA pass

No code changes — verifies the redesigned app end-to-end against a real
engine, per the spec's Testing Strategy.

- [ ] **Step 1: Start the engine dev server**

Run (from repo root): `.venv/bin/uvicorn vmb_engine.api:app --reload`

- [ ] **Step 2: Start the frontend dev server**

Run (from `apps/frontend/`): `npm run dev`

- [ ] **Step 3: Sync pipeline run**

In the browser: build a `csv_loader → train_test_split → random_forest →
evaluate_classifier` pipeline, click Run. Verify: results (including a
confusion matrix, if the dataset/model produce one) appear in the Output
panel's Results tab; the corresponding chart appears in the Visualizations
panel.

- [ ] **Step 4: Long-running (PyTorch) pipeline run**

Build a pipeline using a `long_running` node (e.g. a PyTorch training
node). Click Run. Verify: the Run button shows a spinner and "Running…";
the running node glows on the canvas with a pulsing accent outline; edges
feeding it show the animated dashed-flow effect; the Visualizations panel
shows a live-updating loss/accuracy curve with a "Training…" heading, with
no full-screen modal takeover; on completion the node's ring turns green
and the heading changes to "Training complete".

- [ ] **Step 5: Error case**

Trigger a 422 (e.g. an invalid param value, or disconnect a required
input). Verify: the error message appears in the Output panel's Results
tab. For an async/training run's `node_error`, verify the failing node's
ring turns red on the canvas.

- [ ] **Step 6: Data preview**

Select a node with a `Table` output, click "Preview Output". Verify: the
Output panel switches to the Data Preview tab and shows the table; the
Visualizations panel shows a histogram per numeric column.

- [ ] **Step 7: Panel resize persistence**

Drag a few panel dividers to new positions. Reload the page. Verify the
divider positions persist (via `react-resizable-panels`' `autoSaveId`
`localStorage` persistence).

- [ ] **Step 8: Code view**

Click "View Code". Verify the modal opens, restyled (dark, token-based)
but otherwise functionally unchanged — read-only, syntax-highlighted,
closes via its Close button.

- [ ] **Step 9: Report results**

Summarize pass/fail for each of the above to the user. Fix any issues found
before considering this plan complete.

---
