import { useState } from 'react'
import { metricsRefLabels } from '../metrics/metricsHelpers'
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
  nodeLabels?: Record<string, string>
}

export function OutputPanel({
  activeTab,
  onTabChange,
  runMetrics,
  runError,
  previewState,
  nodeLabels = {},
}: OutputPanelProps) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null)

  const refs = runMetrics ? Object.keys(runMetrics) : []
  const labels = metricsRefLabels(refs, nodeLabels)
  const activeRef = selectedRef && refs.includes(selectedRef) ? selectedRef : refs[0]
  const activeMetrics = runMetrics && activeRef ? (runMetrics[activeRef] as Record<string, unknown>) : null

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
      <div className="output-panel-content" key={activeTab}>
        {activeTab === 'results' && (
          <>
            {runError && <p className="error-banner">{runError}</p>}
            {activeRef && activeMetrics && (
              <div className="metrics-list">
                {refs.length > 1 && (
                  <label className="metrics-selector">
                    <span>Node</span>
                    <select value={activeRef} onChange={(event) => setSelectedRef(event.target.value)}>
                      {refs.map((ref) => (
                        <option key={ref} value={ref}>
                          {labels[ref]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="metrics-block">
                  <h3 className="metrics-block-heading">{labels[activeRef]}</h3>
                  <MetricsSummary metrics={activeMetrics} />
                </div>
              </div>
            )}
            {!runError && !activeRef && <p className="output-panel-empty">Run the pipeline to see results here.</p>}
          </>
        )}
        {activeTab === 'preview' && <PreviewPanel state={previewState} />}
      </div>
    </div>
  )
}
