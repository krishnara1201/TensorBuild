import type { ComponentType } from 'react'
import type { ParamSpec } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { CheckboxParam } from './params/CheckboxParam'
import { FilePickerParam } from './params/FilePickerParam'
import { NumberParam } from './params/NumberParam'
import { SelectParam } from './params/SelectParam'
import { SliderParam } from './params/SliderParam'
import { TextParam } from './params/TextParam'
import type { ParamControlProps } from './params/types'
import { useDynamicOptions } from './useDynamicOptions'

const CONTROLS: Record<ParamSpec['type'], ComponentType<ParamControlProps>> = {
  text: TextParam,
  number: NumberParam,
  select: SelectParam,
  file_picker: FilePickerParam,
  checkbox: CheckboxParam,
  slider: SliderParam,
}

export interface InspectorPanelProps {
  node: PipelineNode | null
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
  onPreview: (nodeId: string, port: string) => void
}

export function InspectorPanel({ node, nodes, edges, onParamChange, onPreview }: InspectorPanelProps) {
  const dynamicOptions = useDynamicOptions(node, nodes, edges)

  if (!node) {
    return (
      <aside className="inspector-panel">
        <p>Select a node to edit its parameters.</p>
      </aside>
    )
  }

  const { manifest, params } = node.data
  const tableOutputs = manifest.outputs.filter((port) => port.type === 'Table')

  return (
    <aside className="inspector-panel">
      <h2>{manifest.label}</h2>
      {manifest.params.map((spec) => {
        const Control = CONTROLS[spec.type]
        return (
          <Control
            key={spec.name}
            spec={spec}
            value={params[spec.name]}
            onChange={(value) => onParamChange(node.id, spec.name, value)}
            dynamicOptions={spec.options_source ? dynamicOptions[spec.name] : undefined}
          />
        )
      })}
      {tableOutputs.length > 0 && (
        <div className="inspector-preview-buttons">
          {tableOutputs.map((port) => (
            <button key={port.name} type="button" onClick={() => onPreview(node.id, port.name)}>
              {tableOutputs.length > 1 ? `Preview ${port.name}` : 'Preview Output'}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
