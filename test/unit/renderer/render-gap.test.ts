import { afterEach, expect, it, vi } from 'vitest'
import { startRenderGapRecording } from '@renderer/render-gap'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('ignores the first frame after hiding and showing the window between animation frames', () => {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback)
    return callbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  const record = vi.fn()
  const stop = startRenderGapRecording(record)
  callbacks.shift()!(100)
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  callbacks.shift()!(10000)
  expect(record).not.toHaveBeenCalled()
  callbacks.shift()!(10120)
  expect(record).toHaveBeenCalledTimes(1)
  expect(record).toHaveBeenCalledWith(120)
  stop()
})
