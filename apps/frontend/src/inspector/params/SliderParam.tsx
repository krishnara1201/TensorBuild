import { NumberParam } from './NumberParam'
import type { ParamControlProps } from './types'

export function SliderParam({ spec, value, onChange }: ParamControlProps) {
  if (spec.min === undefined || spec.max === undefined) {
    // No manifest currently supplies min/max for a slider param (see this
    // plan's Global Constraints); a range input without bounds isn't
    // meaningful, so fall back to a number input.
    return <NumberParam spec={spec} value={value} onChange={onChange} />
  }
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={typeof value === 'number' ? value : spec.min}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
