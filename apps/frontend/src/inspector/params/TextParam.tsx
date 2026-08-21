import type { ParamControlProps } from './types'

export function TextParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
