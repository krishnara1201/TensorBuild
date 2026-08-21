import type { ComponentType } from 'react'
import type { ParamSpec } from '../api/types'
import type { PipelineNode } from '../canvas/types'
import { CheckboxParam } from './params/CheckboxParam'
import { FilePickerParam } from './params/FilePickerParam'
import { NumberParam } from './params/NumberParam'
import { SelectParam } from './params/SelectParam'
import { SliderParam } from './params/SliderParam'
import { TextParam } from './params/TextParam'
import type { ParamControlProps } from './params/types'

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
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
}

export function InspectorPanel({ node, onParamChange }: InspectorPanelProps) {
  if (!node) {
    return (
      <aside className="inspector-panel">
        <p>Select a node to edit its parameters.</p>
      </aside>
    )
  }

  const { manifest, params } = node.data

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
          />
        )
      })}
    </aside>
  )
}
