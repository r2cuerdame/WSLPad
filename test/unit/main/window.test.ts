import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() }
}))

const { sendWhenRendererReady } = await import('../../../src/main/window')

function makeWindow(loading: boolean) {
  let ready: (() => void) | undefined
  let destroyed = false
  const send = vi.fn()
  const once = vi.fn((event: string, listener: () => void) => {
    expect(event).toBe('did-finish-load')
    ready = listener
  })
  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      isLoading: () => loading,
      once,
      send
    }
  }

  return {
    window: window as never,
    send,
    once,
    finishLoading: () => ready?.(),
    destroy: () => {
      destroyed = true
    }
  }
}

describe('sendWhenRendererReady', () => {
  it('sends immediately when the renderer is already loaded', () => {
    const target = makeWindow(false)

    sendWhenRendererReady(target.window, 'navigate', undefined)

    expect(target.once).not.toHaveBeenCalled()
    expect(target.send).toHaveBeenCalledWith('navigate', undefined)
  })

  it('waits for a newly created renderer before sending', () => {
    const target = makeWindow(true)

    sendWhenRendererReady(target.window, 'navigate', undefined)

    expect(target.send).not.toHaveBeenCalled()
    target.finishLoading()
    expect(target.send).toHaveBeenCalledWith('navigate', undefined)
  })

  it('does not send after the window is destroyed while loading', () => {
    const target = makeWindow(true)

    sendWhenRendererReady(target.window, 'navigate', undefined)
    target.destroy()
    target.finishLoading()

    expect(target.send).not.toHaveBeenCalled()
  })
})

describe('on-screen tracking (drives the polling pace)', () => {
  const makeShown = (state: { visible: boolean; minimized: boolean; focused: boolean; destroyed?: boolean }) => {
    const listeners = new Map<string, () => void>()
    const win = {
      isDestroyed: () => state.destroyed === true,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isFocused: () => state.focused,
      on: (event: string, listener: () => void) => listeners.set(event, listener)
    }
    return { win: win as never, emit: (event: string) => listeners.get(event)?.(), state }
  }

  it('counts a shown, unminimized window as on screen, and a hidden or minimized one as off', async () => {
    const { isWindowOnScreen } = await import('../../../src/main/window')
    expect(isWindowOnScreen(makeShown({ visible: true, minimized: false, focused: false }).win)).toBe(true)
    expect(isWindowOnScreen(makeShown({ visible: false, minimized: false, focused: false }).win)).toBe(false)
    expect(isWindowOnScreen(makeShown({ visible: true, minimized: true, focused: false }).win)).toBe(false)
    // Electron reports a window minimized from outside as still focused
    // (visible=false minimized=true focused=true); it is not on screen.
    expect(isWindowOnScreen(makeShown({ visible: false, minimized: true, focused: true }).win)).toBe(false)
    expect(isWindowOnScreen(makeShown({ visible: true, minimized: true, focused: true }).win)).toBe(false)
    expect(isWindowOnScreen(makeShown({ visible: false, minimized: false, focused: true }).win)).toBe(false)
    expect(
      isWindowOnScreen(makeShown({ visible: true, minimized: false, focused: true, destroyed: true }).win)
    ).toBe(false)
  })

  it('reports hide to tray, minimize, restore and close as they happen', async () => {
    const { watchOnScreen } = await import('../../../src/main/window')
    const target = makeShown({ visible: true, minimized: false, focused: true })
    const seen: boolean[] = []
    watchOnScreen(target.win, (onScreen) => seen.push(onScreen))

    target.state.visible = false
    target.state.focused = false
    target.emit('hide')
    target.state.visible = true
    target.emit('show')
    target.state.minimized = true
    target.emit('minimize')
    target.state.minimized = false
    target.emit('restore')
    target.emit('closed')
    expect(seen).toEqual([false, true, false, true, false])
  })
})
