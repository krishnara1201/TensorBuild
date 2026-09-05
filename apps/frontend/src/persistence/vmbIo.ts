import { invoke, isTauri } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { VmbProjectFile } from '../ir/types'

const FILTERS = [{ name: 'TensorBuild Project', extensions: ['vmb'] }]

export type SaveOutcome = { ok: true; path: string | null } | { ok: false; error?: string }
export type OpenOutcome = { ok: true; path: string | null; raw: unknown } | { ok: false; error?: string }

function downloadInBrowser(file: VmbProjectFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pipeline.vmb'
  anchor.click()
  URL.revokeObjectURL(url)
}

function pickFileInBrowser(): Promise<{ ok: true; path: null; raw: unknown } | { ok: false; error?: string }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.vmb'
    input.onchange = () => {
      const selected = input.files?.[0]
      if (!selected) {
        resolve({ ok: false })
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve({ ok: true, path: null, raw: JSON.parse(reader.result as string) })
        } catch {
          resolve({ ok: false, error: 'This file is not valid JSON.' })
        }
      }
      reader.onerror = () => resolve({ ok: false, error: 'Failed to read the selected file.' })
      reader.readAsText(selected)
    }
    // Modern browsers (Chrome 113+/Firefox 109+/Safari 16.4+) fire a 'cancel'
    // event on the <input type="file"> when the picker is dismissed without
    // a selection, so we resolve on that instead of leaving the promise
    // unresolved forever — Tauri's native dialogs (the primary path) resolve
    // `null` on cancel instead.
    input.oncancel = () => resolve({ ok: false })
    input.click()
  })
}

export async function saveProjectAs(file: VmbProjectFile): Promise<SaveOutcome> {
  if (!isTauri()) {
    downloadInBrowser(file)
    return { ok: true, path: null }
  }
  const path = await save({ filters: FILTERS, defaultPath: 'pipeline.vmb' })
  if (typeof path !== 'string') {
    return { ok: false }
  }
  try {
    await invoke('write_vmb_file', { path, contents: JSON.stringify(file, null, 2) })
  } catch (err) {
    return { ok: false, error: String(err) }
  }
  return { ok: true, path }
}

export async function saveProject(file: VmbProjectFile, currentPath: string | null): Promise<SaveOutcome> {
  if (isTauri() && currentPath) {
    try {
      await invoke('write_vmb_file', { path: currentPath, contents: JSON.stringify(file, null, 2) })
    } catch (err) {
      return { ok: false, error: String(err) }
    }
    return { ok: true, path: currentPath }
  }
  return saveProjectAs(file)
}

export async function openProject(): Promise<OpenOutcome> {
  if (!isTauri()) {
    return pickFileInBrowser()
  }
  const path = await open({ multiple: false, filters: FILTERS })
  if (typeof path !== 'string') {
    return { ok: false }
  }
  let contents: string
  try {
    contents = await invoke<string>('read_vmb_file', { path })
  } catch (err) {
    return { ok: false, error: String(err) }
  }
  try {
    return { ok: true, path, raw: JSON.parse(contents) }
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
}
