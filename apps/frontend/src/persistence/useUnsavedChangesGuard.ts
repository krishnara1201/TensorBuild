import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef } from 'react'

export function useUnsavedChangesGuard(isDirty: boolean): void {
  const isDirtyRef = useRef(isDirty)

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined
    let cancelled = false

    getCurrentWindow()
      .onCloseRequested((event) => {
        if (isDirtyRef.current && !window.confirm('You have unsaved changes. Close anyway?')) {
          event.preventDefault()
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          unlisten = fn
        }
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
