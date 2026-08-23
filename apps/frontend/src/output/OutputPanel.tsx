import { MetricsSummary } from '../metrics/MetricsSummary'
import { PreviewPanel } from '../preview/PreviewPanel'
import type { PreviewState } from '../preview/usePreview'

export type OutputTab = 'results' | 'preview'

export interface OutputPanelProps {
  activeTab: OutputTab
  onTabChange: (tab: OutputTab) => void
  runMetrics: Record<string, unknown> | undefined
  runError: string | null
  previewState: PreviewState
}

export function OutputPanel({ activeTab, onTabChange, runMetrics, runError, previewState }: OutputPanelProps) {
  return (
    <div className="output-panel">
      <div className="output-panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'results'}
          className={activeTab === 'results' ? 'output-tab output-tab-active' : 'output-tab'}
          onClick={() => onTabChange('results')}
        >
          Results
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          className={activeTab === 'preview' ? 'output-tab output-tab-active' : 'output-tab'}
          onClick={() => onTabChange('preview')}
        >
          Data Preview
        </button>
      </div>
      <div className="output-panel-content">
        {activeTab === 'results' && (
          <>
            {runError && <p className="error-banner">{runError}</p>}
            {runMetrics && (
              <div className="metrics-list">
                {Object.entries(runMetrics).map(([ref, value]) => (
                  <div key={ref} className="metrics-block">
                    <h3 className="metrics-block-heading">{ref}</h3>
                    <MetricsSummary metrics={value as Record<string, unknown>} />
                  </div>
                ))}
              </div>
            )}
            {!runError && !runMetrics && <p className="output-panel-empty">Run the pipeline to see results here.</p>}
          </>
        )}
        {activeTab === 'preview' && <PreviewPanel state={previewState} />}
      </div>
    </div>
  )
}
