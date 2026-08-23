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
