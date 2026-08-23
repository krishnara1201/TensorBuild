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
    if (dynamicOptions.status === 'error') {
      // A preview failure (transient engine error, a slow/huge upstream,
      // etc.) shouldn't lock the user out of setting this param — fall
      // back to plain manual text entry, same as before this param had a
      // dynamic dropdown, with the error surfaced as a hint rather than a
      // blocker.
      return (
        <div className="param-control-with-hint">
          <TextParam spec={spec} value={value} onChange={onChange} />
          <p className="param-hint param-hint-error">{dynamicOptions.message}</p>
        </div>
      )
    }
    const placeholder = dynamicOptions.status === 'disconnected' ? 'Connect input to see columns' : 'Loading columns…'
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
