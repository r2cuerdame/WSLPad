/** Observe only gaps between frames that both occurred while the window was visible. */
export function startRenderGapRecording(record: (durationMs: number) => void): () => void {
  let last = 0
  let frame = 0
  const reset = (): void => { last = 0 }
  const measure = (now: number): void => {
    if (document.visibilityState === 'visible') {
      if (last > 0 && now - last >= 100) record(now - last)
      last = now
    } else {
      last = 0
    }
    frame = requestAnimationFrame(measure)
  }
  document.addEventListener('visibilitychange', reset)
  frame = requestAnimationFrame(measure)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', reset)
  }
}
