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
