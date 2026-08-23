import { classifyMetricValue, formatMetricKey, nonChartMetrics, type ClassifiedMetric } from './metricsHelpers'

export interface MetricsSummaryProps {
  metrics: Record<string, unknown>
}

function formatNumber(value: number): string {
  return value.toPrecision(4)
}

function StructuredMetric({ classified }: { classified: ClassifiedMetric }) {
  switch (classified.kind) {
    case 'record':
      return (
        <table className="metrics-record-table">
          <tbody>
            {Object.entries(classified.value).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{formatNumber(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'nested-record': {
      const outerKeys = Object.keys(classified.value)
      const innerKeys = Array.from(new Set(outerKeys.flatMap((key) => Object.keys(classified.value[key]))))
      return (
        <table className="metrics-record-table">
          <thead>
            <tr>
              <th />
              {outerKeys.map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {innerKeys.map((innerKey) => (
              <tr key={innerKey}>
                <th>{innerKey}</th>
                {outerKeys.map((outerKey) => (
                  <td key={outerKey}>{formatNumber(classified.value[outerKey][innerKey] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'record-list': {
      const columns = Array.from(new Set(classified.value.flatMap((row) => Object.keys(row))))
      return (
        <table className="metrics-record-table">
          <thead>
            <tr>
              <th />
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classified.value.map((row, index) => (
              <tr key={index}>
                <th>{index}</th>
                {columns.map((column) => (
                  <td key={column}>{formatNumber(row[column] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'value-list':
      return <p className="metrics-value-list">{classified.value.join(', ')}</p>
    default:
      return null
  }
}

export function MetricsSummary({ metrics }: MetricsSummaryProps) {
  const entries = Object.entries(nonChartMetrics(metrics))

  if (entries.length === 0) {
    return null
  }

  const classified = entries.map(([key, value]) => [key, classifyMetricValue(value)] as const)

  if (classified.some(([, c]) => c.kind === 'unknown')) {
    return <pre className="metrics-fallback">{JSON.stringify(Object.fromEntries(entries), null, 2)}</pre>
  }

  const scalarEntries = classified.filter(
    (entry): entry is [string, Extract<ClassifiedMetric, { kind: 'scalar' }>] => entry[1].kind === 'scalar',
  )
  const structuredEntries = classified.filter((entry) => entry[1].kind !== 'scalar')

  return (
    <div className="metrics-summary">
      {scalarEntries.length > 0 && (
        <dl className="metrics-view">
          {scalarEntries.map(([key, c]) => (
            <div className="metrics-stat" key={key}>
              <dt>{formatMetricKey(key)}</dt>
              <dd>{typeof c.value === 'number' ? formatNumber(c.value) : c.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {structuredEntries.map(([key, c]) => (
        <div className="metrics-structured" key={key}>
          <h4 className="metrics-structured-heading">{formatMetricKey(key)}</h4>
          <StructuredMetric classified={c} />
        </div>
      ))}
    </div>
  )
}
