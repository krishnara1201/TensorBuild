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
