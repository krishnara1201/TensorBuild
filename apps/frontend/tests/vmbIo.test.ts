import { afterEach, describe, expect, it, vi } from 'vitest'
import { openProject, saveProject, saveProjectAs } from '../src/persistence/vmbIo'
import type { VmbProjectFile } from '../src/ir/types'

const { openMock, saveMock, invokeMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  saveMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openMock, save: saveMock }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => (globalThis as { isTauri?: boolean }).isTauri === true,
}))

const FILE: VmbProjectFile = {
  version: 1,
  ir: { nodes: [{ id: 'n1', type: 'data.csv_loader', params: {} }], edges: [] },
  layout: { n1: { x: 0, y: 0 } },
}

afterEach(() => {
  ;(globalThis as { isTauri?: boolean }).isTauri = false
  openMock.mockReset()
  saveMock.mockReset()
  invokeMock.mockReset()
})

describe('saveProjectAs inside Tauri', () => {
  it('writes the file to the chosen path and returns it', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProjectAs(FILE)

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] }),
    )
    expect(invokeMock).toHaveBeenCalledWith('write_vmb_file', {
      path: '/home/user/pipeline.vmb',
      contents: JSON.stringify(FILE, null, 2),
    })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb' })
  })

  it('returns {ok: false} when the save dialog is cancelled', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue(null)

    const result = await saveProjectAs(FILE)

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false })
  })

  it('returns {ok: false, error} instead of throwing when the write_vmb_file invoke rejects', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockRejectedValue('permission denied')

    const result = await saveProjectAs(FILE)

    expect(result).toEqual({ ok: false, error: 'permission denied' })
  })
})

describe('saveProject inside Tauri', () => {
  it('writes directly to an existing path without prompting', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProject(FILE, '/home/user/pipeline.vmb')

    expect(saveMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith('write_vmb_file', {
      path: '/home/user/pipeline.vmb',
      contents: JSON.stringify(FILE, null, 2),
    })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb' })
  })

  it('falls back to prompting (Save As) when there is no current path', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    saveMock.mockResolvedValue('/home/user/new.vmb')
    invokeMock.mockResolvedValue(undefined)

    const result = await saveProject(FILE, null)

    expect(saveMock).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, path: '/home/user/new.vmb' })
  })
})

describe('openProject inside Tauri', () => {
  it('reads and parses the chosen file', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockResolvedValue(JSON.stringify(FILE))

    const result = await openProject()

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] }),
    )
    expect(invokeMock).toHaveBeenCalledWith('read_vmb_file', { path: '/home/user/pipeline.vmb' })
    expect(result).toEqual({ ok: true, path: '/home/user/pipeline.vmb', raw: FILE })
  })

  it('returns {ok: false} when the open dialog is cancelled', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue(null)

    const result = await openProject()

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false })
  })

  it('returns an error result when the file contents are not valid JSON', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue('/home/user/broken.vmb')
    invokeMock.mockResolvedValue('not json{{{')

    const result = await openProject()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not valid json/i)
  })

  it('returns {ok: false, error} instead of throwing when the read_vmb_file invoke rejects', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    openMock.mockResolvedValue('/home/user/pipeline.vmb')
    invokeMock.mockRejectedValue('file not found')

    const result = await openProject()

    expect(result).toEqual({ ok: false, error: 'file not found' })
  })
})

describe('outside Tauri', () => {
  it('saveProjectAs triggers a browser download and reports success with no path', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const result = await saveProjectAs(FILE)

    expect(clickSpy).toHaveBeenCalled()
    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock')
    expect(result).toEqual({ ok: true, path: null })

    clickSpy.mockRestore()
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
  })

  it('saveProject always behaves like saveProjectAs (no path is ever remembered)', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const result = await saveProject(FILE, '/some/remembered/path.vmb')

    expect(clickSpy).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, path: null })

    vi.restoreAllMocks()
  })
})
