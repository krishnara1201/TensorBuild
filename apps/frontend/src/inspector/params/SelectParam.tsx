import { TextParam } from './TextParam'
import type { ParamControlProps } from './types'

export function SelectParam({ spec, value, onChange }: ParamControlProps) {
  if (!spec.options || spec.options.length === 0) {
    // No manifest currently supplies `options` for a select param (see this
    // plan's Global Constraints); fall back to freeform text until one does.
    return <TextParam spec={spec} value={value} onChange={onChange} />
  }
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        {spec.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
