import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { PreviewResult } from '../api/types'
import { extractConfusionMatrix, extractRocCurve, metricsRefLabels } from '../metrics/metricsHelpers'
import type { TrainingState } from '../training/useTrainingRun'
import { computeHistograms } from './histogram'
import { MetricsCharts } from './MetricsCharts'

export interface VisualizationsPanelProps {
  runMetrics: Record<string, unknown> | undefined
  previewData: PreviewResult | undefined
  trainingState: TrainingState | undefined
  nodeLabels?: Record<string, string>
}

const CHART_WIDTH = 280
const CHART_HEIGHT = 200

function trainingStatusLabel(status: TrainingState['status']): string {
  if (status === 'complete') return 'Training complete'
  if (status === 'error') return 'Training failed'
  return 'Training…'
}

export function VisualizationsPanel({ runMetrics, previewData, trainingState, nodeLabels = {} }: VisualizationsPanelProps) {
  const [selectedChartRef, setSelectedChartRef] = useState<string | null>(null)
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null)

  const histograms = previewData ? computeHistograms(previewData).filter((histogram) => histogram.bins.length > 0) : []
  const chartableRefs = runMetrics
    ? Object.keys(runMetrics).filter((ref) => {
        const metrics = runMetrics[ref] as Record<string, unknown>
        return Boolean(extractConfusionMatrix(metrics) || extractRocCurve(metrics))
      })
    : []
  const chartLabels = metricsRefLabels(chartableRefs, nodeLabels)
  const activeChartRef =
    selectedChartRef && chartableRefs.includes(selectedChartRef) ? selectedChartRef : chartableRefs[0]

  const columns = histograms.map((histogram) => histogram.column)
  const activeColumn = selectedColumn && columns.includes(selectedColumn) ? selectedColumn : columns[0]
  const activeHistogram = histograms.find((histogram) => histogram.column === activeColumn)

  const showEmpty = chartableRefs.length === 0 && histograms.length === 0 && !trainingState

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

      {activeChartRef && runMetrics && (
        <section className="visualizations-section">
          {chartableRefs.length > 1 && (
            <label className="metrics-selector">
              <span>Node</span>
              <select value={activeChartRef} onChange={(event) => setSelectedChartRef(event.target.value)}>
                {chartableRefs.map((ref) => (
                  <option key={ref} value={ref}>
                    {chartLabels[ref]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3 className="visualizations-section-heading">{chartLabels[activeChartRef]}</h3>
          <MetricsCharts metrics={runMetrics[activeChartRef] as Record<string, unknown>} />
        </section>
      )}

      {activeHistogram && (
        <section className="visualizations-section">
          {columns.length > 1 && (
            <label className="metrics-selector">
              <span>Column</span>
              <select value={activeColumn} onChange={(event) => setSelectedColumn(event.target.value)}>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3 className="visualizations-section-heading">{activeHistogram.column} distribution</h3>
          <BarChart width={CHART_WIDTH} height={CHART_HEIGHT} data={activeHistogram.bins}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bin" tick={false} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="var(--color-accent)" />
          </BarChart>
        </section>
      )}

      {showEmpty && <p className="output-panel-empty">Run the pipeline or preview data to see charts here.</p>}
    </div>
  )
}
