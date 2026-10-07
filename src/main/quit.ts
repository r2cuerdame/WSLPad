/** Hold Electron's first quit request until asynchronous local recording has flushed. */
export function createBeforeQuitHandler(
  markQuitting: () => void,
  dispose: () => Promise<void>,
  quit: () => void
): (event?: { preventDefault(): void }) => void {
  let finishing = false
  let finished = false
  return (event) => {
    markQuitting()
    if (!event) return
    if (finished) return
    event.preventDefault()
    if (finishing) return
    finishing = true
    void dispose().catch((error: unknown) => {
      console.error('WSLPad shutdown cleanup failed', error)
    }).finally(() => {
      finished = true
      quit()
    })
  }
}
