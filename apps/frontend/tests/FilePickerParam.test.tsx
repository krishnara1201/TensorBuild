import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePickerParam } from '../src/inspector/params/FilePickerParam'
import type { ParamSpec } from '../src/api/types'

const { openMock, onDragDropEventMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  onDragDropEventMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock }),
}))

const SPEC: ParamSpec = { name: 'path', type: 'file_picker', label: 'File Path', default: '' }

afterEach(() => {
  ;(globalThis as { isTauri?: boolean }).isTauri = false
  openMock.mockReset()
  onDragDropEventMock.mockReset()
  onDragDropEventMock.mockResolvedValue(() => {})
})

describe('FilePickerParam outside Tauri', () => {
  it('renders a plain path input and reports changes', async () => {
    const onChange = vi.fn()
    render(<FilePickerParam spec={SPEC} value="" onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('File Path'), 'a')

    expect(onChange).toHaveBeenCalledWith('a')
  })
})

describe('FilePickerParam inside Tauri', () => {
  it('renders a Browse button that sets the param to the dialog result', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    onDragDropEventMock.mockResolvedValue(() => {})
    openMock.mockResolvedValue('/home/user/data.csv')
    const onChange = vi.fn()
    render(<FilePickerParam spec={SPEC} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /browse/i }))

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'CSV', extensions: ['csv'] }] }),
    )
    expect(onChange).toHaveBeenCalledWith('/home/user/data.csv')
  })

  it('ignores a cancelled dialog (null result)', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    onDragDropEventMock.mockResolvedValue(() => {})
    openMock.mockResolvedValue(null)
    const onChange = vi.fn()
    render(<FilePickerParam spec={SPEC} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /browse/i }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('registers a drag-and-drop listener and sets the param on drop', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    let dropHandler: ((event: { payload: { type: string; paths?: string[] } }) => void) | undefined
    onDragDropEventMock.mockImplementation((handler) => {
      dropHandler = handler
      return Promise.resolve(() => {})
    })
    const onChange = vi.fn()
    render(<FilePickerParam spec={SPEC} value="" onChange={onChange} />)

    expect(onDragDropEventMock).toHaveBeenCalled()
    dropHandler?.({ payload: { type: 'drop', paths: ['/home/user/dropped.csv'] } })

    expect(onChange).toHaveBeenCalledWith('/home/user/dropped.csv')
  })
})
