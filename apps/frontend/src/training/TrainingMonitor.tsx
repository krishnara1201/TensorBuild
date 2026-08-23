import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { MetricsView } from '../metrics/MetricsView'
import { useTrainingRun, type TrainingState } from './useTrainingRun'

export interface TrainingMonitorProps {
  runId: string
  onClose: () => void
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 300

function statusHeading(status: TrainingState['status']): string {
  if (status === 'complete') return 'Training complete'
  if (status === 'error') return 'Training failed'
  return 'Training…'
}

export function TrainingMonitor({ runId, onClose }: TrainingMonitorProps) {
  const state = useTrainingRun(runId)

  return (
    <div className="modal-panel">
      <div className="modal-panel-header">
        <h2>{statusHeading(state.status)}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="training-monitor-chart">
        <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={state.history}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="epoch" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="loss" name="Loss" stroke="#4a90d9" dot={false} />
          <Line type="monotone" dataKey="val_loss" name="Validation Loss" stroke="#e67e22" dot={false} />
        </LineChart>
      </div>

      {state.status === 'complete' && (
        <div className="metrics-list">
          {Object.entries(state.metrics).map(([ref, value]) => (
            <div key={ref} className="metrics-block">
              <h3 className="metrics-block-heading">{ref}</h3>
              <MetricsView metrics={value as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}

      {state.status === 'error' && <p className="error-banner">{state.error}</p>}
    </div>
  )
}
