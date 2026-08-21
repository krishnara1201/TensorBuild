import type { ParamControlProps } from './types'

export function FilePickerParam({ spec, value, onChange }: ParamControlProps) {
  // No Tauri shell exists in this browser-only slice, so there is no native
  // file dialog available; render a plain path input instead.
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <input
        type="text"
        placeholder="/path/to/file"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
