import type { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { BottomRow } from './BottomRow'
import { TopRow } from './TopRow'

export interface AppLayoutProps {
  palette: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  output: ReactNode
  visualizations: ReactNode
}

export function AppLayout({ palette, canvas, inspector, output, visualizations }: AppLayoutProps) {
  return (
    <div className="app-body">
      <PanelGroup direction="vertical" autoSaveId="vmb-layout-outer">
        <Panel id="top" defaultSize={65} minSize={30}>
          <TopRow palette={palette} canvas={canvas} inspector={inspector} />
        </Panel>
        <PanelResizeHandle className="layout-resize-handle layout-resize-handle-horizontal" />
        <Panel id="bottom" defaultSize={35} minSize={15}>
          <BottomRow output={output} visualizations={visualizations} />
        </Panel>
      </PanelGroup>
    </div>
  )
}
