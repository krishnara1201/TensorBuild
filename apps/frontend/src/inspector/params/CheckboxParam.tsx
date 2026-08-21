import type { ParamControlProps } from './types'

export function CheckboxParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control param-control-checkbox">
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      <span>{spec.label}</span>
    </label>
  )
}
