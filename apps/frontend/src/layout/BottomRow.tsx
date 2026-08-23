import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export interface BottomRowProps {
  output: ReactNode
  visualizations: ReactNode
}

export function BottomRow({ output, visualizations }: BottomRowProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="vmb-layout-bottom">
      <Panel id="output" defaultSize={50} minSize={20} className="layout-panel">
        {output}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="visualizations" defaultSize={50} minSize={20} className="layout-panel">
        {visualizations}
      </Panel>
    </PanelGroup>
  )
}
