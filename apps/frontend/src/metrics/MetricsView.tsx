export interface MetricsViewProps {
  metrics: Record<string, unknown>
}

function isConfusionMatrix(
  metrics: Record<string, unknown>,
): metrics is Record<string, unknown> & { confusion_matrix: number[][]; labels: unknown[] } {
  return Array.isArray(metrics.confusion_matrix) && Array.isArray(metrics.labels)
}

function formatKey(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function MetricsView({ metrics }: MetricsViewProps) {
  if (isConfusionMatrix(metrics)) {
    const { confusion_matrix: matrix, labels } = metrics
    const rest = Object.fromEntries(
      Object.entries(metrics).filter(([key]) => key !== 'confusion_matrix' && key !== 'labels'),
    )
    return (
      <div className="metrics-view">
        <table className="confusion-matrix-table">
          <thead>
            <tr>
              <th />
              {labels.map((label, i) => (
                <th key={i}>{String(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>{String(labels[rowIndex])}</th>
                {row.map((count, colIndex) => (
                  <td key={colIndex} className={rowIndex === colIndex ? 'confusion-matrix-diagonal' : undefined}>
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(rest).length > 0 && <MetricsView metrics={rest} />}
      </div>
    )
  }

  const entries = Object.entries(metrics)
  const allScalar = entries.length > 0 && entries.every(([, value]) => typeof value === 'number')
  if (allScalar) {
    return (
      <dl className="metrics-view">
        {entries.map(([key, value]) => (
          <div className="metrics-stat" key={key}>
            <dt>{formatKey(key)}</dt>
            <dd>{(value as number).toPrecision(4)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return <pre className="metrics-fallback">{JSON.stringify(metrics, null, 2)}</pre>
}
