import { expect, it, vi } from 'vitest'
import { createBeforeQuitHandler } from '../../../src/main/quit'

it('waits for local recording cleanup before allowing the app to quit', async () => {
  let finish!: () => void
  const dispose = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const quit = vi.fn()
  const markQuitting = vi.fn()
  const preventDefault = vi.fn()
  const beforeQuit = createBeforeQuitHandler(markQuitting, dispose, quit)
  beforeQuit({ preventDefault })
  beforeQuit({ preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(quit).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  beforeQuit({ preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2)
  expect(markQuitting).toHaveBeenCalledTimes(3)
})
