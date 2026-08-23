import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export interface TopRowProps {
  palette: ReactNode
  canvas: ReactNode
  inspector: ReactNode
}

export function TopRow({ palette, canvas, inspector }: TopRowProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="vmb-layout-top">
      <Panel id="palette" defaultSize={15} minSize={10} className="layout-panel">
        {palette}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="canvas" defaultSize={60} minSize={30} className="layout-panel layout-panel-canvas">
        {canvas}
      </Panel>
      <PanelResizeHandle className="layout-resize-handle" />
      <Panel id="inspector" defaultSize={25} minSize={15} className="layout-panel">
        {inspector}
      </Panel>
    </PanelGroup>
  )
}
