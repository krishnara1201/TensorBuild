import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ParamControlProps } from './types'

// The window runs with native OS drag-drop disabled (dragDropEnabled: false
// in tauri.conf.json) so the palette-to-canvas HTML5 drag-and-drop works on
// Windows/WebView2 — the two can't coexist in one webview. That means this
// control can't listen for a dropped file's path; Browse… (the file dialog)
// is the only way to pick a file in the Tauri shell.
export function FilePickerParam({ spec, value, onChange }: ParamControlProps) {
  const inTauri = isTauri()

  if (!inTauri) {
    // No Tauri shell in this context (plain browser dev mode) — a browser
    // can't expose a dropped file's real filesystem path, so fall back to
    // manual entry.
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

  const handleBrowse = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (typeof selected === 'string') {
      onChange(selected)
    }
  }

  return (
    <div className="param-control">
      <span>{spec.label}</span>
      <div className="file-picker">
        <input
          type="text"
          readOnly
          placeholder="Browse for a file…"
          value={typeof value === 'string' ? value : ''}
        />
        <button type="button" onClick={handleBrowse}>
          Browse…
        </button>
      </div>
    </div>
  )
}
