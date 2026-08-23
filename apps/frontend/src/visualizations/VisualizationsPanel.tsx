import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { PreviewResult } from '../api/types'
import { extractConfusionMatrix, extractRocCurve } from '../metrics/metricsHelpers'
import type { TrainingState } from '../training/useTrainingRun'
import { computeHistograms } from './histogram'
import { MetricsCharts } from './MetricsCharts'

export interface VisualizationsPanelProps {
  runMetrics: Record<string, unknown> | undefined
  previewData: PreviewResult | undefined
  trainingState: TrainingState | undefined
}

const CHART_WIDTH = 280
const CHART_HEIGHT = 200

function trainingStatusLabel(status: TrainingState['status']): string {
  if (status === 'complete') return 'Training complete'
  if (status === 'error') return 'Training failed'
  return 'Training…'
}

export function VisualizationsPanel({ runMetrics, previewData, trainingState }: VisualizationsPanelProps) {
  const histograms = previewData ? computeHistograms(previewData).filter((histogram) => histogram.bins.length > 0) : []
  const chartableMetricsEntries = runMetrics
    ? Object.entries(runMetrics).filter(([, value]) => {
        const metrics = value as Record<string, unknown>
        return Boolean(extractConfusionMatrix(metrics) || extractRocCurve(metrics))
      })
    : []
  const showEmpty = chartableMetricsEntries.length === 0 && histograms.length === 0 && !trainingState

  return (
    <div className="visualizations-panel">
      {trainingState && (
        <section className="visualizations-section">
          <h3 className="visualizations-section-heading">{trainingStatusLabel(trainingState.status)}</h3>
          <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={trainingState.history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="epoch" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="loss" name="Loss" stroke="var(--color-accent)" dot={false} />
            <Line
              type="monotone"
              dataKey="val_loss"
              name="Validation Loss"
              stroke="var(--color-warning)"
              dot={false}
            />
          </LineChart>
        </section>
      )}

      {chartableMetricsEntries.map(([ref, value]) => (
        <section className="visualizations-section" key={ref}>
          <h3 className="visualizations-section-heading">{ref}</h3>
          <MetricsCharts metrics={value as Record<string, unknown>} />
        </section>
      ))}

      {histograms.map((histogram) => (
        <section className="visualizations-section" key={histogram.column}>
          <h3 className="visualizations-section-heading">{histogram.column} distribution</h3>
          <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={histogram.bins}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bin" tick={false} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="var(--color-accent)" />
          </BarChart>
        </section>
      ))}

      {showEmpty && <p className="output-panel-empty">Run the pipeline or preview data to see charts here.</p>}
    </div>
  )
}
