import { describe, expect, it } from 'vitest'
import {
  extractConfusionMatrix,
  extractRocCurve,
  formatMetricKey,
  metricsRefLabels,
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

describe('metricsRefLabels', () => {
  it('resolves a ref to its node label', () => {
    expect(metricsRefLabels(['n2.metrics'], { n2: 'Evaluate Classifier' })).toEqual({
      'n2.metrics': 'Evaluate Classifier',
    })
  })

  it('falls back to the raw node id when the node has no known label', () => {
    expect(metricsRefLabels(['n2.metrics'], {})).toEqual({ 'n2.metrics': 'n2' })
  })

  it('disambiguates with the node id when two refs share a label', () => {
    expect(
      metricsRefLabels(['n2.metrics', 'n5.metrics'], {
        n2: 'Evaluate Classifier',
        n5: 'Evaluate Classifier',
      }),
    ).toEqual({
      'n2.metrics': 'Evaluate Classifier (n2)',
      'n5.metrics': 'Evaluate Classifier (n5)',
    })
  })
})
