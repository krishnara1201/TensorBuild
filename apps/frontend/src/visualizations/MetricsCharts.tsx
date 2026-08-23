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
