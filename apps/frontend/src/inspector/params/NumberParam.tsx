import type { ParamControlProps } from './types'

export function NumberParam({ spec, value, onChange }: ParamControlProps) {
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    </label>
  )
}
