import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedChangesGuard } from '../src/persistence/useUnsavedChangesGuard'

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>

const { onCloseRequestedMock } = vi.hoisted(() => {
  return { onCloseRequestedMock: vi.fn() }
})

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => {
    // Access the real global value set by tests
    return (globalThis as { isTauri?: boolean }).isTauri === true
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: onCloseRequestedMock }),
}))

beforeEach(() => {
  // Default: just resolve with an unlisten function
  onCloseRequestedMock.mockImplementation(() => Promise.resolve(() => {}))
})

afterEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { isTauri?: boolean }).isTauri = false
})

describe('useUnsavedChangesGuard outside Tauri', () => {
  it('registers no close-requested listener', () => {
    renderHook(() => useUnsavedChangesGuard(true))

    expect(onCloseRequestedMock).not.toHaveBeenCalled()
  })
})

describe('useUnsavedChangesGuard inside Tauri', () => {
  it('registers a close-requested listener', () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true

    renderHook(() => useUnsavedChangesGuard(false))

    expect(onCloseRequestedMock).toHaveBeenCalled()
  })

  it('prevents closing when dirty and the user cancels the confirm', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    })
    rerender({ dirty: true })

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(window.confirm).toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalled()
  })

  it('allows closing when dirty and the user confirms', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    })
    rerender({ dirty: true })

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('allows closing without prompting when not dirty', async () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    const confirmSpy = vi.spyOn(window, 'confirm')
    let handler: CloseHandler | undefined
    onCloseRequestedMock.mockImplementation((h: CloseHandler) => {
      handler = h
      return Promise.resolve(() => {})
    })

    renderHook(() => useUnsavedChangesGuard(false))

    const preventDefault = vi.fn()
    await handler?.({ preventDefault })

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
