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
