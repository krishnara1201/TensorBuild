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

export type ClassifiedMetric =
  | { kind: 'scalar'; value: number | string }
  | { kind: 'record'; value: Record<string, number> }
  | { kind: 'nested-record'; value: Record<string, Record<string, number>> }
  | { kind: 'record-list'; value: Record<string, number>[] }
  | { kind: 'value-list'; value: (number | string)[] }
  | { kind: 'unknown' }

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isNumber)
}

/**
 * Classifies a metric value into a shape MetricsSummary knows how to render:
 * a plain scalar, a flat dict of numbers, a dict of dicts of numbers (e.g.
 * per-class coefficients), a list of dicts of numbers (e.g. cluster
 * centers), or a flat list of scalars. Anything else is 'unknown' and falls
 * back to a raw JSON dump.
 */
export function classifyMetricValue(value: unknown): ClassifiedMetric {
  if (typeof value === 'number' || typeof value === 'string') {
    return { kind: 'scalar', value }
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number' || typeof item === 'string')) {
      return { kind: 'value-list', value: value as (number | string)[] }
    }
    if (value.every(isRecordOfNumbers)) {
      return { kind: 'record-list', value: value as Record<string, number>[] }
    }
    return { kind: 'unknown' }
  }
  if (isPlainObject(value)) {
    if (isRecordOfNumbers(value)) {
      return { kind: 'record', value }
    }
    if (Object.values(value).every(isRecordOfNumbers)) {
      return { kind: 'nested-record', value: value as Record<string, Record<string, number>> }
    }
    return { kind: 'unknown' }
  }
  return { kind: 'unknown' }
}

/**
 * Resolves each metrics ref ("n2.metrics") to a display label using the
 * owning node's manifest label ("Evaluate Classifier"), falling back to the
 * raw node id when the node has no known label. When two refs resolve to
 * the same label (two nodes of the same type), the node id is appended to
 * each to disambiguate.
 */
export function metricsRefLabels(
  refs: string[],
  nodeLabels: Record<string, string>,
): Record<string, string> {
  const nodeIdFor = (ref: string) => ref.split('.')[0]
  const baseLabelFor = (ref: string) => nodeLabels[nodeIdFor(ref)] ?? nodeIdFor(ref)

  const counts = new Map<string, number>()
  for (const ref of refs) {
    const label = baseLabelFor(ref)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Object.fromEntries(
    refs.map((ref) => {
      const label = baseLabelFor(ref)
      const display = (counts.get(label) ?? 0) > 1 ? `${label} (${nodeIdFor(ref)})` : label
      return [ref, display]
    }),
  )
}
