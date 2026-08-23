import { TextParam } from './TextParam'
import type { ParamControlProps } from './types'

export function SelectParam({ spec, value, onChange, dynamicOptions }: ParamControlProps) {
  if (dynamicOptions) {
    if (dynamicOptions.status === 'ready') {
      return (
        <label className="param-control">
          <span>{spec.label}</span>
          <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
            <option value="" disabled>
              Select a column…
            </option>
            {dynamicOptions.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )
    }
    const placeholder =
      dynamicOptions.status === 'disconnected'
        ? 'Connect input to see columns'
        : dynamicOptions.status === 'loading'
          ? 'Loading columns…'
          : dynamicOptions.message
    return (
      <label className="param-control">
        <span>{spec.label}</span>
        <select disabled value="">
          <option value="">{placeholder}</option>
        </select>
      </label>
    )
  }

  if (!spec.options || spec.options.length === 0) {
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
