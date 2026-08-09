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
