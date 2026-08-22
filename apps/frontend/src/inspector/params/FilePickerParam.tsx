import { useEffect, useRef } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import type { ParamControlProps } from './types'

export function FilePickerParam({ spec, value, onChange }: ParamControlProps) {
  const inTauri = isTauri()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!inTauri) return
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      const [path] = event.payload.paths
      if (path) onChangeRef.current(path)
    })
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [inTauri])

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
          placeholder="Drop a file here or browse…"
          value={typeof value === 'string' ? value : ''}
        />
        <button type="button" onClick={handleBrowse}>
          Browse…
        </button>
      </div>
    </div>
  )
}
