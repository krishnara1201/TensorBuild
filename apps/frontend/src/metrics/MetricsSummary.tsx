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
