import type { PreviewState } from './usePreview'

export interface PreviewPanelProps {
  state: PreviewState
  onClose: () => void
}

export function PreviewPanel({ state, onClose }: PreviewPanelProps) {
  return (
    <aside className="preview-panel">
      <div className="modal-panel-header">
        <h2>Data Preview</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'error' && <p className="error-banner">{state.error}</p>}
      {state.status === 'success' && (
        <>
          <div className="preview-table-scroll">
            <table className="preview-table">
              <thead>
                <tr>
                  {state.data.columns.map((col) => (
                    <th key={col.name}>
                      {col.name}
                      <div className="preview-table-dtype">{col.dtype}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="preview-table-footer">
            Showing {state.data.rows.length} of {state.data.total_rows.toLocaleString()} rows
          </p>
        </>
      )}
    </aside>
  )
}
