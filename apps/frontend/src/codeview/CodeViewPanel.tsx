import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export interface CodeViewPanelProps {
  code: string
  onClose: () => void
}

export function CodeViewPanel({ code, onClose }: CodeViewPanelProps) {
  return (
    <div className="code-view-panel">
      <div className="code-view-panel-header">
        <h2>Generated Code</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <SyntaxHighlighter language="python" style={oneDark}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
